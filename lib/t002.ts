// Shared helpers for T-002 (routed-item responsiveness baseline) instrumentation.
// See docs/experiments/T-002.md for the pre-registered spec these support.

import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export const T002_OBSERVATION_HOURS = Number(process.env.T002_OBSERVATION_HOURS ?? 168);

// ── Pre-enrollment body-completeness boundary (eligibility mirror) ───────────
// The actual eligibility gate is enforced inside t002_try_enroll() in
// supabase/migrations-11-t002-body-completeness-boundary.sql, under the same
// row lock that already serializes the cap check — this repo has no live test
// database, so that SQL cannot be exercised directly from here. This function
// mirrors the exact same comparison in TypeScript so the eligibility LOGIC
// (inclusive >=, null-is-never-eligible) is directly unit-testable; it is not
// itself called anywhere in the enrollment path — the SQL function is the real
// enforcement point. Kept in sync deliberately: if this comparison ever needs
// to change, migrations-11's SQL must change identically.
export function isEligibleForEnrollment(
  proposalCreatedAt: string | null,
  boundaryAt: string | null
): boolean {
  if (boundaryAt === null) return false; // boundary not yet activated
  if (proposalCreatedAt === null) return false; // unknown creation time is never eligible
  return new Date(proposalCreatedAt).getTime() >= new Date(boundaryAt).getTime();
}

export const PROPOSAL_EVENT_TYPES = [
  "detected",
  "passed_filter",
  "proposal_created",
  "notification_attempted",
  "notification_accepted",
  "viewed",
  "sent",
  "skipped",
  "expired",
  "failed",
] as const;
export type ProposalEventType = (typeof PROPOSAL_EVENT_TYPES)[number];

const MIN_SAMPLE_SIZE = 5;

// ── Event metadata safety ─────────────────────────────────────────────────────
// Defense in depth: no current call site passes bodies/drafts/tokens, but this
// guard makes it structurally hard to add one by accident later.

const FORBIDDEN_METADATA_KEYS = new Set([
  "body",
  "draft",
  "draft_body",
  "email_body",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "snippet",
  "content",
  "attachment",
]);
const MAX_METADATA_VALUE_LENGTH = 200;

export function sanitizeEventMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string" && value.length > MAX_METADATA_VALUE_LENGTH) continue;
    out[key] = value;
  }
  return out;
}

export async function logProposalEvent(
  db: Db,
  proposalId: string,
  eventType: ProposalEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await db.from("proposal_events").insert({
    proposal_id: proposalId,
    event_type: eventType,
    metadata: sanitizeEventMetadata(metadata),
  });
  if (error) console.warn(`[t002] event log failed (${eventType}):`, error);
}

// ── Sender parsing (for filter_rejections — no body/subject stored) ────────────

export function extractSourceIdentifier(fromHeader: string): string {
  const inner = fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader;
  return inner.trim().toLowerCase();
}

export function extractSourceDomain(fromHeader: string): string {
  return extractSourceIdentifier(fromHeader).match(/@([\w.-]+)/)?.[1] ?? "";
}

export async function logFilterRejection(
  db: Db,
  msg: { id: string; from: string }
): Promise<void> {
  const { error } = await db.from("filter_rejections").insert({
    gmail_message_id: msg.id,
    source_domain: extractSourceDomain(msg.from),
    source_identifier: extractSourceIdentifier(msg.from),
  });
  // 23505 = unique violation on gmail_message_id — this message was already
  // logged on an earlier watch run (still unread, dropped again). Expected, not
  // an error.
  if (error && error.code !== "23505") {
    console.warn("[t002] rejection log failed:", error);
  }
}

// ── Median latency, null- and negative-interval-safe ────────────────────────────

export interface MedianResult {
  medianMs: number | null;
  n: number;
  insufficientData: boolean;
}

export function medianIntervalMs(
  pairs: Array<{ start: string | null; end: string | null }>
): MedianResult {
  const intervals: number[] = [];
  for (const { start, end } of pairs) {
    if (!start || !end) continue; // never coerce a missing timestamp to zero
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (!Number.isFinite(ms) || ms < 0) continue; // ignore negative intervals
    intervals.push(ms);
  }
  const n = intervals.length;
  if (n < MIN_SAMPLE_SIZE) {
    return { medianMs: null, n, insufficientData: true };
  }
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const medianMs = n % 2 === 0 ? (intervals[mid - 1] + intervals[mid]) / 2 : intervals[mid];
  return { medianMs, n, insufficientData: false };
}

// ── Instrumentation canary ───────────────────────────────────────────────────────
// The state is computed here, not inferred in the UI, specifically so the
// zero-decisions case can never be displayed as "within threshold" — it has no
// threshold to be within yet.

export type CanaryState = "no_data" | "within_threshold" | "breached";

export interface CanaryResult {
  decidedWithoutViewCount: number;
  decidedItemCount: number;
  rate: number | null; // null only in the no_data state
  state: CanaryState;
}

const CANARY_BREACH_RATE = 0.05;

export function computeInstrumentationCanary(
  proposals: Array<{ decision_at: string | null; first_viewed_at: string | null }>
): CanaryResult {
  let decidedWithoutViewCount = 0;
  let decidedItemCount = 0;
  for (const p of proposals) {
    if (!p.decision_at) continue;
    decidedItemCount++;
    if (!p.first_viewed_at) decidedWithoutViewCount++;
  }

  if (decidedItemCount === 0) {
    return { decidedWithoutViewCount, decidedItemCount, rate: null, state: "no_data" };
  }

  const rate = decidedWithoutViewCount / decidedItemCount;
  return {
    decidedWithoutViewCount,
    decidedItemCount,
    rate,
    state: rate > CANARY_BREACH_RATE ? "breached" : "within_threshold",
  };
}

// ── Signal 1 — unresolved after view ─────────────────────────────────────────────
// Eligible denominator: enrolled proposals with a non-null first_viewed_at where
// at least 24h have elapsed since that view. Numerator: among those, proposals
// with no decision inside the first 24h after view — this covers "still
// unresolved," "decided but more than 24h after viewing," and "expired after
// view without a decision inside the first 24h" (expiration never sets
// decision_at, so an expired-after-view row falls out of the "no decision"
// branch below with no special-casing needed).
//
// Excluded from the denominator entirely (not just from the numerator): rows
// missing first_viewed_at, rows where fewer than 24h have elapsed since view, and
// rows with a negative interval anywhere in the computation (a first_viewed_at in
// the future relative to "now," or a decision_at that precedes first_viewed_at —
// both indicate untrustworthy timestamp data, consistent with how
// medianIntervalMs treats negative intervals elsewhere in this module: excluded,
// never coerced).

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SIGNAL1_MIN_ELIGIBLE = 10;
const SIGNAL1_THRESHOLD_RATE = 0.25;

export interface Signal1Result {
  signal1EligibleCount: number;
  signal1UnresolvedAt24hCount: number;
  signal1Rate: number | null;
  signal1MinimumReached: boolean;
  signal1ThresholdMet: boolean;
}

export function computeSignal1(
  proposals: Array<{ first_viewed_at: string | null; decision_at: string | null }>,
  nowMs: number = Date.now()
): Signal1Result {
  let eligibleCount = 0;
  let unresolvedAt24hCount = 0;

  for (const p of proposals) {
    if (!p.first_viewed_at) continue; // exclude: missing first_viewed_at

    const viewedMs = new Date(p.first_viewed_at).getTime();
    if (!Number.isFinite(viewedMs)) continue;

    const elapsedSinceView = nowMs - viewedMs;
    if (elapsedSinceView < 0) continue; // exclude: negative interval
    if (elapsedSinceView < TWENTY_FOUR_HOURS_MS) continue; // exclude: not yet 24h since view

    let decisionLatencyMs: number | null = null;
    if (p.decision_at) {
      const decisionMs = new Date(p.decision_at).getTime();
      if (!Number.isFinite(decisionMs)) continue;
      decisionLatencyMs = decisionMs - viewedMs;
      if (decisionLatencyMs < 0) continue; // exclude: negative interval
    }

    eligibleCount++;

    if (decisionLatencyMs === null || decisionLatencyMs > TWENTY_FOUR_HOURS_MS) {
      unresolvedAt24hCount++;
    }
  }

  const rate = eligibleCount === 0 ? null : unresolvedAt24hCount / eligibleCount;
  const minimumReached = eligibleCount >= SIGNAL1_MIN_ELIGIBLE;

  return {
    signal1EligibleCount: eligibleCount,
    signal1UnresolvedAt24hCount: unresolvedAt24hCount,
    signal1Rate: rate,
    signal1MinimumReached: minimumReached,
    signal1ThresholdMet: minimumReached && rate !== null && rate >= SIGNAL1_THRESHOLD_RATE,
  };
}

// ── Total system latency — excludes rows with an inferred source_received_at ────
// A row whose source_received_at fell back to processing time (Gmail Date header
// missing) does not measure true source-to-decision latency, so it must not enter
// this specific median even though the same row is fine for the other two.

export function totalSystemLatencyPairs(
  proposals: Array<{
    source_received_at: string | null;
    decision_at: string | null;
    source_received_at_inferred?: boolean | null;
  }>
): Array<{ start: string | null; end: string | null }> {
  return proposals
    .filter((p) => !p.source_received_at_inferred)
    .map((p) => ({ start: p.source_received_at, end: p.decision_at }));
}

// ── Route-decision helpers ────────────────────────────────────────────────────────
// Pure classification logic extracted out of the route handlers so it's directly
// unit-testable without a live database. The routes are thin wrappers: run the
// guarded DB write, hand the result to these functions, return what they say.

export interface GuardedTransitionOutcome {
  status: number;
  body: { ok: true } | { error: string; code: "PROPOSAL_NOT_PENDING" };
}

// The guarded status-transition UPDATE (WHERE status = 'pending') can affect zero
// rows for two reasons: it already transitioned (a duplicate/racing call), or it
// was claimed by expiration first. Either way, no decision_at/outcome/sent_at/
// skipped_at was written and no event was logged for THIS call — the caller must
// not treat this as success.
export function classifyGuardedTransition(updatedRow: { id: string } | null): GuardedTransitionOutcome {
  if (updatedRow) {
    return { status: 200, body: { ok: true } };
  }
  return {
    status: 409,
    body: { error: "Proposal is no longer pending", code: "PROPOSAL_NOT_PENDING" },
  };
}

export type FirstViewOutcome =
  | { viewed: true; status: 200; body: { ok: true; viewed: true } }
  | {
      viewed: false;
      status: 200;
      body: { ok: true; viewed: false; code: "ALREADY_VIEWED" | "PROPOSAL_NOT_PENDING" };
    }
  | { viewed: false; status: 404; body: { error: string; code: "PROPOSAL_NOT_FOUND" } };

// updatedRow is the result of the guarded UPDATE (WHERE status='pending' AND
// first_viewed_at IS NULL). When it's null, currentRow (a plain follow-up SELECT,
// not itself a write) disambiguates why: not found, no longer pending (including
// a stale client re-opening an already-expired/sent/skipped card), or already
// viewed (idempotent no-op — the common case on every re-expand).
export function classifyFirstView(
  updatedRow: { id: string } | null,
  currentRow: { status: string; first_viewed_at: string | null } | null
): FirstViewOutcome {
  if (updatedRow) {
    return { viewed: true, status: 200, body: { ok: true, viewed: true } };
  }
  if (!currentRow) {
    return {
      viewed: false,
      status: 404,
      body: { error: "Proposal not found", code: "PROPOSAL_NOT_FOUND" },
    };
  }
  if (currentRow.status !== "pending") {
    return {
      viewed: false,
      status: 200,
      body: { ok: true, viewed: false, code: "PROPOSAL_NOT_PENDING" },
    };
  }
  return { viewed: false, status: 200, body: { ok: true, viewed: false, code: "ALREADY_VIEWED" } };
}

// ── Resend response interpretation ───────────────────────────────────────────────
// Resend's send API confirms the request was ACCEPTED by their API — never that
// the email was actually delivered to the owner's inbox (no delivery webhook
// exists in this repo). This function must never be renamed/reframed to imply
// delivery.

export interface ResendSendResult {
  data?: { id: string } | null;
  error?: { message: string } | null;
}

export function interpretResendResult(result: ResendSendResult): {
  accepted: boolean;
  id?: string;
} {
  if (result.error) return { accepted: false };
  if (result.data?.id) return { accepted: true, id: result.data.id };
  return { accepted: false };
}

// ── Expiration ──────────────────────────────────────────────────────────────────

export async function expireOverdueT002Proposals(db: Db): Promise<{ expiredCount: number }> {
  const { data, error } = await db.rpc("t002_expire_overdue", {
    p_hours: T002_OBSERVATION_HOURS,
  });
  if (error) {
    console.warn("[t002] expiration failed:", error);
    return { expiredCount: 0 };
  }
  const ids = (data ?? []).map((row: { proposal_id: string }) => row.proposal_id);
  for (const id of ids) {
    await logProposalEvent(db, id, "expired");
  }
  return { expiredCount: ids.length };
}

// ── Source-completeness provenance metrics ────────────────────────────────────
// content_completeness and locally_truncated are stored as separate, orthogonal
// columns on pending_proposals (see supabase/migrations-10-gmail-body-
// provenance.sql) — never combined into a stored enum. The groups below are a
// DASHBOARD PRESENTATION computed here from the two raw columns; nothing about
// this function's output is persisted anywhere.
//
// legacy/unknown is precisely: content_completeness IS NULL, OR
// content_completeness IS 'full'/'partial' AND locally_truncated IS NULL (the
// derived full/partial × truncation split needs both dimensions known to place
// a row — 'snippet_only'/'fetch_failed' don't have a truncation-qualified
// derived group at all, so a null locally_truncated on those rows does NOT
// make them legacy/unknown). A null is never coerced to false anywhere here.

interface ProvenanceRow {
  content_completeness: string | null;
  locally_truncated: boolean | null;
}

export interface T002ProvenanceMetrics {
  // Raw orthogonal dimensions.
  fullCount: number;
  partialCount: number;
  snippetOnlyCount: number;
  fetchFailedCount: number;
  locallyTruncatedCount: number; // locally_truncated = true, spans full AND partial
  notLocallyTruncatedCount: number; // locally_truncated = false (known, not null)
  legacyUnknownCount: number;
  // Derived presentation groups (full/partial × truncation only — snippet_only,
  // fetch_failed, and legacy_unknown above already ARE their own groups).
  fullNotTruncated: number;
  fullTruncated: number;
  partialNotTruncated: number;
  partialTruncated: number;
}

export function computeProvenanceMetrics(proposals: ProvenanceRow[]): T002ProvenanceMetrics {
  let fullCount = 0;
  let partialCount = 0;
  let snippetOnlyCount = 0;
  let fetchFailedCount = 0;
  let locallyTruncatedCount = 0;
  let notLocallyTruncatedCount = 0;
  let legacyUnknownCount = 0;
  let fullNotTruncated = 0;
  let fullTruncated = 0;
  let partialNotTruncated = 0;
  let partialTruncated = 0;

  for (const p of proposals) {
    const truncated = p.locally_truncated;
    if (truncated === true) locallyTruncatedCount++;
    else if (truncated === false) notLocallyTruncatedCount++;
    // truncated === null contributes to neither raw truncation count.

    switch (p.content_completeness) {
      case "full":
        fullCount++;
        if (truncated === true) fullTruncated++;
        else if (truncated === false) fullNotTruncated++;
        else legacyUnknownCount++; // completeness known, truncation unknown
        break;
      case "partial":
        partialCount++;
        if (truncated === true) partialTruncated++;
        else if (truncated === false) partialNotTruncated++;
        else legacyUnknownCount++; // completeness known, truncation unknown
        break;
      case "snippet_only":
        snippetOnlyCount++;
        break;
      case "fetch_failed":
        fetchFailedCount++;
        break;
      default:
        legacyUnknownCount++; // content_completeness is null
        break;
    }
  }

  return {
    fullCount,
    partialCount,
    snippetOnlyCount,
    fetchFailedCount,
    locallyTruncatedCount,
    notLocallyTruncatedCount,
    legacyUnknownCount,
    fullNotTruncated,
    fullTruncated,
    partialNotTruncated,
    partialTruncated,
  };
}

// ── Owner-page metrics ────────────────────────────────────────────────────────────

interface PendingProposalMetricRow {
  id: string;
  status: string | null;
  outcome: string | null;
  source_received_at: string | null;
  source_received_at_inferred: boolean | null;
  notification_attempted_at: string | null;
  notification_accepted_at: string | null;
  first_viewed_at: string | null;
  decision_at: string | null;
  expired_at: string | null;
  content_completeness: string | null;
  locally_truncated: boolean | null;
}

export interface T002Metrics {
  cap: number;
  enrolledCount: number;
  // Null until t002_activate_body_completeness_boundary() has been run — see
  // supabase/migrations-11-t002-body-completeness-boundary.sql. While null,
  // t002_try_enroll() refuses every enrollment attempt; enrolledCount stays 0.
  bodyCompletenessBoundaryAt: string | null;
  provenance: T002ProvenanceMetrics;
  statusCounts: { pending: number; sent: number; skipped: number; expired: number; failed: number };
  neverNotifiedCount: number;
  neverViewedCount: number;
  // Currently-pending items that have been viewed but not yet decided, as of
  // this snapshot — a coverage metric, NOT Signal 1 (which requires the 24h
  // eligibility gate; see signal1* fields below).
  viewedButUnresolvedCount: number;
  expiredWithoutViewCount: number;
  expiredAfterViewCount: number;
  notificationToViewMedian: MedianResult;
  viewToDecisionMedian: MedianResult;
  totalSystemLatencyMedian: MedianResult;
  decidedWithin24hOfView: { count: number; denominator: number };
  canary: CanaryResult;
  signal1EligibleCount: number;
  signal1UnresolvedAt24hCount: number;
  signal1Rate: number | null;
  signal1MinimumReached: boolean;
  signal1ThresholdMet: boolean;
  rejections: {
    reviewedCount: number;
    timeSensitiveCount: number;
    unreviewedCount: number;
    falseNegativeFraction: number | null;
  };
}

export async function computeT002Metrics(db: Db): Promise<T002Metrics> {
  const { data: counter } = await db
    .from("t002_enrollment_counter")
    .select("cap, enrolled_count, body_completeness_boundary_at")
    .eq("id", true)
    .maybeSingle();
  const cap = counter?.cap ?? 0;
  const enrolledCount = counter?.enrolled_count ?? 0;
  const bodyCompletenessBoundaryAt = counter?.body_completeness_boundary_at ?? null;

  const { data: observations } = await db.from("t002_observations").select("proposal_id");
  const enrolledIds = (observations ?? []).map((o) => o.proposal_id);

  let proposals: PendingProposalMetricRow[] = [];
  if (enrolledIds.length > 0) {
    const { data } = await db
      .from("pending_proposals")
      .select(
        "id, status, outcome, source_received_at, source_received_at_inferred, notification_attempted_at, notification_accepted_at, first_viewed_at, decision_at, expired_at, content_completeness, locally_truncated"
      )
      .in("id", enrolledIds);
    proposals = data ?? [];
  }

  const provenance = computeProvenanceMetrics(proposals);

  const statusCounts = { pending: 0, sent: 0, skipped: 0, expired: 0, failed: 0 };
  let neverNotifiedCount = 0;
  let neverViewedCount = 0;
  let viewedButUnresolvedCount = 0;
  let expiredWithoutViewCount = 0;
  let expiredAfterViewCount = 0;
  let decidedWithin24h = 0;
  let decidedWithin24hDenominator = 0;

  for (const p of proposals) {
    const status = (p.status ?? "pending") as keyof typeof statusCounts;
    if (status in statusCounts) statusCounts[status]++;

    if (!p.notification_attempted_at) neverNotifiedCount++;
    if (!p.first_viewed_at) neverViewedCount++;
    if (p.first_viewed_at && !p.decision_at && status === "pending") viewedButUnresolvedCount++;
    if (status === "expired" && !p.first_viewed_at) expiredWithoutViewCount++;
    if (status === "expired" && p.first_viewed_at) expiredAfterViewCount++;

    if (p.first_viewed_at && p.decision_at) {
      const ms = new Date(p.decision_at).getTime() - new Date(p.first_viewed_at).getTime();
      if (Number.isFinite(ms) && ms >= 0) {
        decidedWithin24hDenominator++;
        if (ms <= 24 * 60 * 60 * 1000) decidedWithin24h++;
      }
    }
  }

  const notificationToViewMedian = medianIntervalMs(
    proposals.map((p) => ({ start: p.notification_accepted_at, end: p.first_viewed_at }))
  );
  const viewToDecisionMedian = medianIntervalMs(
    proposals.map((p) => ({ start: p.first_viewed_at, end: p.decision_at }))
  );
  // Excludes rows whose source_received_at fell back to processing time (Gmail
  // Date header missing) — those don't measure true source-to-decision latency.
  const totalSystemLatencyMedian = medianIntervalMs(totalSystemLatencyPairs(proposals));

  const canary = computeInstrumentationCanary(proposals);
  const signal1 = computeSignal1(proposals);

  const { count: reviewedCount } = await db
    .from("filter_rejections")
    .select("id", { count: "exact", head: true })
    .neq("review_outcome", "unreviewed");
  const { count: timeSensitiveCount } = await db
    .from("filter_rejections")
    .select("id", { count: "exact", head: true })
    .eq("review_outcome", "time_sensitive");
  const { count: unreviewedCount } = await db
    .from("filter_rejections")
    .select("id", { count: "exact", head: true })
    .eq("review_outcome", "unreviewed");

  const reviewed = reviewedCount ?? 0;
  const timeSensitive = timeSensitiveCount ?? 0;

  return {
    cap,
    enrolledCount,
    bodyCompletenessBoundaryAt,
    provenance,
    statusCounts,
    neverNotifiedCount,
    neverViewedCount,
    viewedButUnresolvedCount,
    expiredWithoutViewCount,
    expiredAfterViewCount,
    notificationToViewMedian,
    viewToDecisionMedian,
    totalSystemLatencyMedian,
    decidedWithin24hOfView: { count: decidedWithin24h, denominator: decidedWithin24hDenominator },
    canary,
    ...signal1,
    rejections: {
      reviewedCount: reviewed,
      timeSensitiveCount: timeSensitive,
      unreviewedCount: unreviewedCount ?? 0,
      falseNegativeFraction: reviewed > 0 ? timeSensitive / reviewed : null,
    },
  };
}
