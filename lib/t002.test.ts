import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSourceDomain,
  extractSourceIdentifier,
  sanitizeEventMetadata,
  medianIntervalMs,
  computeInstrumentationCanary,
  computeSignal1,
  totalSystemLatencyPairs,
  classifyGuardedTransition,
  classifyFirstView,
  computeProvenanceMetrics,
  isEligibleForEnrollment,
  T002_OBSERVATION_HOURS,
} from "./t002.ts";

test("extractSourceIdentifier / extractSourceDomain — 'Name <addr>' form", () => {
  assert.equal(extractSourceIdentifier("Jane Doe <Jane@Example.COM>"), "jane@example.com");
  assert.equal(extractSourceDomain("Jane Doe <jane@example.com>"), "example.com");
});

test("extractSourceIdentifier / extractSourceDomain — bare address form", () => {
  assert.equal(extractSourceIdentifier("jane@example.com"), "jane@example.com");
  assert.equal(extractSourceDomain("jane@example.com"), "example.com");
});

test("extractSourceDomain — no domain found returns empty string, never throws", () => {
  assert.equal(extractSourceDomain("not-an-email"), "");
});

test("sanitizeEventMetadata — strips forbidden keys case-insensitively", () => {
  const out = sanitizeEventMetadata({ body: "secret text", Token: "abc", safe_label: "kept" });
  assert.deepEqual(out, { safe_label: "kept" });
});

test("sanitizeEventMetadata — drops long string values (likely content, not a label)", () => {
  const longValue = "x".repeat(500);
  const out = sanitizeEventMetadata({ long: longValue, short: "ok" });
  assert.deepEqual(out, { short: "ok" });
});

test("sanitizeEventMetadata — undefined input returns empty object", () => {
  assert.deepEqual(sanitizeEventMetadata(undefined), {});
});

test("medianIntervalMs — insufficient data below minimum sample size", () => {
  const result = medianIntervalMs([
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T02:00:00Z" },
  ]);
  assert.equal(result.insufficientData, true);
  assert.equal(result.medianMs, null);
  assert.equal(result.n, 2);
});

test("medianIntervalMs — null timestamps are excluded, never coerced to zero", () => {
  const pairs = [
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" },
    { start: null, end: "2026-01-01T02:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: null },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T03:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T05:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T07:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T09:00:00Z" },
  ];
  const result = medianIntervalMs(pairs);
  // 5 valid intervals: 1h, 3h, 5h, 7h, 9h -> median 5h
  assert.equal(result.n, 5);
  assert.equal(result.insufficientData, false);
  assert.equal(result.medianMs, 5 * 60 * 60 * 1000);
});

test("medianIntervalMs — negative intervals are ignored, not treated as zero", () => {
  const pairs = [
    { start: "2026-01-01T02:00:00Z", end: "2026-01-01T00:00:00Z" }, // negative — clock skew
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T02:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T03:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T04:00:00Z" },
    { start: "2026-01-01T00:00:00Z", end: "2026-01-01T05:00:00Z" },
  ];
  const result = medianIntervalMs(pairs);
  assert.equal(result.n, 5); // the negative one excluded
  assert.equal(result.insufficientData, false);
});

test("computeInstrumentationCanary — no decisions yields state 'no_data', never 'within_threshold'", () => {
  const result = computeInstrumentationCanary([
    { decision_at: null, first_viewed_at: null },
    { decision_at: null, first_viewed_at: "2026-01-01T00:00:00Z" },
  ]);
  assert.equal(result.decidedItemCount, 0);
  assert.equal(result.rate, null);
  assert.equal(result.state, "no_data");
});

test("computeInstrumentationCanary — state 'breached' above 5%", () => {
  const proposals = [
    // 2 decided without a view, 18 decided with a view -> 2/20 = 10% > 5%
    ...Array.from({ length: 2 }, () => ({ decision_at: "2026-01-01T00:00:00Z", first_viewed_at: null })),
    ...Array.from({ length: 18 }, () => ({
      decision_at: "2026-01-01T00:00:00Z",
      first_viewed_at: "2026-01-01T00:00:00Z",
    })),
  ];
  const result = computeInstrumentationCanary(proposals);
  assert.equal(result.decidedItemCount, 20);
  assert.equal(result.decidedWithoutViewCount, 2);
  assert.equal(result.rate, 0.1);
  assert.equal(result.state, "breached");
});

test("computeInstrumentationCanary — state 'within_threshold' at or under 5%", () => {
  const proposals = [
    { decision_at: "2026-01-01T00:00:00Z", first_viewed_at: null },
    ...Array.from({ length: 99 }, () => ({
      decision_at: "2026-01-01T00:00:00Z",
      first_viewed_at: "2026-01-01T00:00:00Z",
    })),
  ];
  const result = computeInstrumentationCanary(proposals);
  assert.equal(result.rate, 0.01);
  assert.equal(result.state, "within_threshold");
});

// ── computeSignal1 ────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-02-01T00:00:00Z").getTime();
function hoursAgo(h: number): string {
  return new Date(NOW - h * HOUR).toISOString();
}

test("computeSignal1 — excludes rows viewed fewer than 24h ago", () => {
  const result = computeSignal1(
    [{ first_viewed_at: hoursAgo(23), decision_at: null }],
    NOW
  );
  assert.equal(result.signal1EligibleCount, 0);
  assert.equal(result.signal1Rate, null);
});

test("computeSignal1 — counts still-pending (no decision) after 24h as unresolved", () => {
  const result = computeSignal1(
    [{ first_viewed_at: hoursAgo(48), decision_at: null }],
    NOW
  );
  assert.equal(result.signal1EligibleCount, 1);
  assert.equal(result.signal1UnresolvedAt24hCount, 1);
});

test("computeSignal1 — counts a decision made more than 24h after view as unresolved", () => {
  const viewedAt = hoursAgo(48);
  const decidedAt = new Date(new Date(viewedAt).getTime() + 30 * HOUR).toISOString(); // 30h after view
  const result = computeSignal1([{ first_viewed_at: viewedAt, decision_at: decidedAt }], NOW);
  assert.equal(result.signal1EligibleCount, 1);
  assert.equal(result.signal1UnresolvedAt24hCount, 1);
});

test("computeSignal1 — excludes a decision made within 24h of view from the unresolved count", () => {
  const viewedAt = hoursAgo(48);
  const decidedAt = new Date(new Date(viewedAt).getTime() + 5 * HOUR).toISOString(); // 5h after view
  const result = computeSignal1([{ first_viewed_at: viewedAt, decision_at: decidedAt }], NOW);
  assert.equal(result.signal1EligibleCount, 1);
  assert.equal(result.signal1UnresolvedAt24hCount, 0);
});

test("computeSignal1 — excludes rows with a negative decision interval from the denominator", () => {
  const viewedAt = hoursAgo(48);
  const decidedAt = new Date(new Date(viewedAt).getTime() - HOUR).toISOString(); // "before" view
  const result = computeSignal1([{ first_viewed_at: viewedAt, decision_at: decidedAt }], NOW);
  assert.equal(result.signal1EligibleCount, 0);
});

test("computeSignal1 — excludes a first_viewed_at in the future relative to now", () => {
  const result = computeSignal1([{ first_viewed_at: hoursAgo(-1), decision_at: null }], NOW);
  assert.equal(result.signal1EligibleCount, 0);
});

test("computeSignal1 — enforces minimum eligible n=10", () => {
  const proposals = Array.from({ length: 9 }, () => ({
    first_viewed_at: hoursAgo(48),
    decision_at: null,
  }));
  const result = computeSignal1(proposals, NOW);
  assert.equal(result.signal1EligibleCount, 9);
  assert.equal(result.signal1MinimumReached, false);
  assert.equal(result.signal1ThresholdMet, false); // even though rate would be 100%
});

test("computeSignal1 — threshold met at exactly 25% with n=10 or more", () => {
  const unresolved = Array.from({ length: 25 }, () => ({
    first_viewed_at: hoursAgo(48),
    decision_at: null,
  }));
  const resolvedWithin24h = Array.from({ length: 75 }, () => {
    const viewedAt = hoursAgo(48);
    const decidedAt = new Date(new Date(viewedAt).getTime() + 2 * HOUR).toISOString();
    return { first_viewed_at: viewedAt, decision_at: decidedAt };
  });
  const result = computeSignal1([...unresolved, ...resolvedWithin24h], NOW);
  assert.equal(result.signal1EligibleCount, 100);
  assert.equal(result.signal1UnresolvedAt24hCount, 25);
  assert.equal(result.signal1Rate, 0.25);
  assert.equal(result.signal1MinimumReached, true);
  assert.equal(result.signal1ThresholdMet, true);
});

test("computeSignal1 — just under 25% does not meet threshold", () => {
  const unresolved = Array.from({ length: 24 }, () => ({
    first_viewed_at: hoursAgo(48),
    decision_at: null,
  }));
  const resolved = Array.from({ length: 76 }, () => {
    const viewedAt = hoursAgo(48);
    const decidedAt = new Date(new Date(viewedAt).getTime() + 2 * HOUR).toISOString();
    return { first_viewed_at: viewedAt, decision_at: decidedAt };
  });
  const result = computeSignal1([...unresolved, ...resolved], NOW);
  assert.equal(result.signal1Rate, 0.24);
  assert.equal(result.signal1ThresholdMet, false);
});

// ── totalSystemLatencyPairs ───────────────────────────────────────────────────

test("totalSystemLatencyPairs — excludes rows with an inferred source_received_at", () => {
  const pairs = totalSystemLatencyPairs([
    {
      source_received_at: "2026-01-01T00:00:00Z",
      decision_at: "2026-01-01T01:00:00Z",
      source_received_at_inferred: true,
    },
    {
      source_received_at: "2026-01-01T00:00:00Z",
      decision_at: "2026-01-01T01:00:00Z",
      source_received_at_inferred: false,
    },
    {
      source_received_at: "2026-01-01T00:00:00Z",
      decision_at: "2026-01-01T01:00:00Z",
      source_received_at_inferred: null,
    },
  ]);
  assert.equal(pairs.length, 2); // the inferred:true row is excluded; false and null pass through
});

// ── classifyGuardedTransition (PATCH /api/owner/inbox/[id]) ──────────────────

test("classifyGuardedTransition — 200 ok when the guarded update affected a row", () => {
  const outcome = classifyGuardedTransition({ id: "abc" });
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { ok: true });
});

test("classifyGuardedTransition — 409 with a machine-readable code on zero affected rows", () => {
  const outcome = classifyGuardedTransition(null);
  assert.equal(outcome.status, 409);
  assert.deepEqual(outcome.body, {
    error: "Proposal is no longer pending",
    code: "PROPOSAL_NOT_PENDING",
  });
});

// ── classifyFirstView (POST /api/owner/inbox/[id]/view) ───────────────────────

test("classifyFirstView — viewed:true when the guarded update affected a row", () => {
  const outcome = classifyFirstView({ id: "abc" }, null);
  assert.equal(outcome.viewed, true);
  assert.equal(outcome.status, 200);
});

test("classifyFirstView — 404 when the proposal does not exist", () => {
  const outcome = classifyFirstView(null, null);
  assert.equal(outcome.viewed, false);
  assert.equal(outcome.status, 404);
  assert.equal(outcome.body.code, "PROPOSAL_NOT_FOUND");
});

test("classifyFirstView — PROPOSAL_NOT_PENDING for an expired/sent/skipped row, no viewed event", () => {
  const outcome = classifyFirstView(null, { status: "expired", first_viewed_at: null });
  assert.equal(outcome.viewed, false);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.code, "PROPOSAL_NOT_PENDING");
});

test("classifyFirstView — ALREADY_VIEWED is idempotent, not an error", () => {
  const outcome = classifyFirstView(null, {
    status: "pending",
    first_viewed_at: "2026-01-01T00:00:00Z",
  });
  assert.equal(outcome.viewed, false);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.code, "ALREADY_VIEWED");
});

// ── computeProvenanceMetrics ───────────────────────────────────────────────────

test("computeProvenanceMetrics — content_completeness and locally_truncated remain independent", () => {
  const metrics = computeProvenanceMetrics([
    { content_completeness: "full", locally_truncated: true },
    { content_completeness: "full", locally_truncated: false },
    { content_completeness: "partial", locally_truncated: true },
  ]);
  // Raw dimensions are counted independently of each other.
  assert.equal(metrics.fullCount, 2);
  assert.equal(metrics.partialCount, 1);
  assert.equal(metrics.locallyTruncatedCount, 2); // spans full AND partial
  assert.equal(metrics.notLocallyTruncatedCount, 1);
});

test("computeProvenanceMetrics — full + truncated derived group is correct", () => {
  const metrics = computeProvenanceMetrics([
    { content_completeness: "full", locally_truncated: true },
    { content_completeness: "full", locally_truncated: true },
    { content_completeness: "full", locally_truncated: false },
  ]);
  assert.equal(metrics.fullCount, 3);
  assert.equal(metrics.fullTruncated, 2);
  assert.equal(metrics.fullNotTruncated, 1);
});

test("computeProvenanceMetrics — partial + truncated derived group is correct", () => {
  const metrics = computeProvenanceMetrics([
    { content_completeness: "partial", locally_truncated: true },
    { content_completeness: "partial", locally_truncated: false },
    { content_completeness: "partial", locally_truncated: false },
  ]);
  assert.equal(metrics.partialCount, 3);
  assert.equal(metrics.partialTruncated, 1);
  assert.equal(metrics.partialNotTruncated, 2);
});

test("computeProvenanceMetrics — null content_completeness is legacy/unknown, never full or partial", () => {
  const metrics = computeProvenanceMetrics([
    { content_completeness: null, locally_truncated: null },
    { content_completeness: null, locally_truncated: false }, // even with truncation known
  ]);
  assert.equal(metrics.fullCount, 0);
  assert.equal(metrics.partialCount, 0);
  assert.equal(metrics.legacyUnknownCount, 2);
});

test("computeProvenanceMetrics — full/partial with null locally_truncated is legacy/unknown, never 'not truncated'", () => {
  const metrics = computeProvenanceMetrics([
    { content_completeness: "full", locally_truncated: null },
    { content_completeness: "partial", locally_truncated: null },
  ]);
  assert.equal(metrics.fullCount, 1); // raw dimension still counts it
  assert.equal(metrics.partialCount, 1);
  assert.equal(metrics.fullNotTruncated, 0); // NOT coerced into "not truncated"
  assert.equal(metrics.fullTruncated, 0);
  assert.equal(metrics.partialNotTruncated, 0);
  assert.equal(metrics.partialTruncated, 0);
  assert.equal(metrics.legacyUnknownCount, 2);
});

test("computeProvenanceMetrics — snippet_only and fetch_failed are unaffected by truncation being null", () => {
  const metrics = computeProvenanceMetrics([
    { content_completeness: "snippet_only", locally_truncated: null },
    { content_completeness: "fetch_failed", locally_truncated: null },
  ]);
  assert.equal(metrics.snippetOnlyCount, 1);
  assert.equal(metrics.fetchFailedCount, 1);
  // Neither counts toward legacy/unknown — they don't need truncation known.
  assert.equal(metrics.legacyUnknownCount, 0);
});

test("computeProvenanceMetrics — empty enrolled population returns all zeros, not an error state", () => {
  const metrics = computeProvenanceMetrics([]);
  assert.equal(metrics.fullCount, 0);
  assert.equal(metrics.partialCount, 0);
  assert.equal(metrics.snippetOnlyCount, 0);
  assert.equal(metrics.fetchFailedCount, 0);
  assert.equal(metrics.locallyTruncatedCount, 0);
  assert.equal(metrics.notLocallyTruncatedCount, 0);
  assert.equal(metrics.legacyUnknownCount, 0);
});

// ── isEligibleForEnrollment (TypeScript mirror of the SQL boundary check) ────
// See lib/t002.ts's comment: the real gate is in t002_try_enroll() (SQL); this
// tests the LOGIC in isolation since there's no live test database this turn.

test("isEligibleForEnrollment — a proposal created before the boundary is not eligible", () => {
  assert.equal(
    isEligibleForEnrollment("2026-08-05T11:59:59.999Z", "2026-08-05T12:00:00.000Z"),
    false
  );
});

test("isEligibleForEnrollment — a proposal created exactly at the boundary IS eligible (inclusive >=)", () => {
  assert.equal(
    isEligibleForEnrollment("2026-08-05T12:00:00.000Z", "2026-08-05T12:00:00.000Z"),
    true
  );
});

test("isEligibleForEnrollment — a proposal created after the boundary is eligible", () => {
  assert.equal(
    isEligibleForEnrollment("2026-08-05T12:00:00.001Z", "2026-08-05T12:00:00.000Z"),
    true
  );
});

test("isEligibleForEnrollment — a null boundary (not yet activated) refuses every proposal", () => {
  assert.equal(isEligibleForEnrollment("2026-08-05T12:00:00.000Z", null), false);
});

test("isEligibleForEnrollment — an unknown proposal_created_at is never eligible", () => {
  assert.equal(isEligibleForEnrollment(null, "2026-08-05T12:00:00.000Z"), false);
});

// ── Locked protocol constants — regression guards ───────────────────────────────
// These pin down the exact values/boundaries this amendment must not change.

test("locked constant — T002_OBSERVATION_HOURS defaults to 168", () => {
  assert.equal(T002_OBSERVATION_HOURS, 168);
});

test("locked threshold — Signal 1 requires exactly n>=10 eligible (9 fails, 10 passes the minimum)", () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.now();
  const nineEligible = Array.from({ length: 9 }, () => ({
    first_viewed_at: new Date(NOW - 48 * HOUR).toISOString(),
    decision_at: null,
  }));
  const tenEligible = Array.from({ length: 10 }, () => ({
    first_viewed_at: new Date(NOW - 48 * HOUR).toISOString(),
    decision_at: null,
  }));
  assert.equal(computeSignal1(nineEligible, NOW).signal1MinimumReached, false);
  assert.equal(computeSignal1(tenEligible, NOW).signal1MinimumReached, true);
});

test("locked threshold — Signal 1 requires exactly rate>=0.25 (24.9% fails, 25.0% passes)", () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.now();
  const viewed = (n: number) =>
    Array.from({ length: n }, () => ({
      first_viewed_at: new Date(NOW - 48 * HOUR).toISOString(),
      decision_at: null,
    }));
  // 24 unresolved / 100 eligible = 24% -> below threshold
  const just_under = [...viewed(24), ...Array.from({ length: 76 }, () => {
    const at = new Date(NOW - 48 * HOUR).toISOString();
    return { first_viewed_at: at, decision_at: new Date(new Date(at).getTime() + HOUR).toISOString() };
  })];
  // 25 unresolved / 100 eligible = 25% -> meets threshold
  const exactly_25 = [...viewed(25), ...Array.from({ length: 75 }, () => {
    const at = new Date(NOW - 48 * HOUR).toISOString();
    return { first_viewed_at: at, decision_at: new Date(new Date(at).getTime() + HOUR).toISOString() };
  })];
  assert.equal(computeSignal1(just_under, NOW).signal1ThresholdMet, false);
  assert.equal(computeSignal1(exactly_25, NOW).signal1ThresholdMet, true);
});

test("locked threshold — canary breach boundary is exactly >5% (5.0% is within threshold, 6% is breached)", () => {
  const atFivePercent = [
    { decision_at: "2026-01-01T00:00:00Z", first_viewed_at: null },
    ...Array.from({ length: 19 }, () => ({
      decision_at: "2026-01-01T00:00:00Z",
      first_viewed_at: "2026-01-01T00:00:00Z",
    })),
  ]; // 1/20 = 5.0%
  const aboveFivePercent = [
    { decision_at: "2026-01-01T00:00:00Z", first_viewed_at: null },
    { decision_at: "2026-01-01T00:00:00Z", first_viewed_at: null },
    ...Array.from({ length: 18 }, () => ({
      decision_at: "2026-01-01T00:00:00Z",
      first_viewed_at: "2026-01-01T00:00:00Z",
    })),
  ]; // 2/20 = 10%
  assert.equal(computeInstrumentationCanary(atFivePercent).state, "within_threshold");
  assert.equal(computeInstrumentationCanary(aboveFivePercent).state, "breached");
});

// ── Migration file static checks (no live database this turn) ─────────────────

async function readRepoFile(...segments: string[]): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, "..", ...segments), "utf-8");
}

test("migrations-09 — locked cap (15) is still the only value inserted", async () => {
  const sql = await readRepoFile("supabase", "migrations-09-t002-instrumentation.sql");
  assert.match(sql, /VALUES \(TRUE, 15, 0\)/);
});

test("migrations-11 — never alters the cap", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  assert.ok(!/SET\s+cap\s*=/i.test(sql), "migration 11 must not modify the locked cap");
});

test("migrations-11 — boundary column carries no DEFAULT (would stamp existing state)", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  const line = sql.split("\n").find((l) => l.includes("ADD COLUMN IF NOT EXISTS body_completeness_boundary_at"));
  assert.ok(line);
  assert.ok(!/DEFAULT/i.test(line!));
});

test("migrations-11 — t002_try_enroll refuses enrollment while the boundary is null", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  assert.match(sql, /IF v_boundary IS NULL THEN\s*\n\s*RETURN FALSE/);
});

test("migrations-11 — t002_try_enroll enforces proposal_created_at >= boundary via the reject condition", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  // Rejects when proposal_created_at < boundary (or unknown) — the complement is >=.
  assert.match(sql, /v_proposal_created_at IS NULL OR v_proposal_created_at < v_boundary/);
});

test("migrations-11 — activation refuses when enrolled_count is not 0", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  assert.match(sql, /IF v_enrolled_count <> 0 THEN\s*\n\s*RAISE EXCEPTION/);
});

test("migrations-11 — activation refuses when any t002_observations row exists", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  assert.match(sql, /SELECT count\(\*\) INTO v_observation_count FROM t002_observations/);
  assert.match(sql, /IF v_observation_count <> 0 THEN\s*\n\s*RAISE EXCEPTION/);
});

test("migrations-11 — activation refuses when the boundary is already set (never silently replaced)", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  assert.match(sql, /IF v_existing_boundary IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION/);
});

test("migrations-11 — activation function never resets enrolled_count, never deletes/updates observations", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  const activationFn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION t002_activate_body_completeness_boundary"),
    sql.length
  );
  assert.ok(!/SET\s+enrolled_count\s*=\s*0/i.test(activationFn));
  assert.ok(!/DELETE FROM t002_observations/i.test(activationFn));
  assert.ok(!/UPDATE t002_observations/i.test(activationFn));
});

test("migrations-11 — activation locks the same singleton counter row enrollment uses (FOR UPDATE)", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  const activationFn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION t002_activate_body_completeness_boundary"),
    sql.length
  );
  assert.match(activationFn, /FROM t002_enrollment_counter\s*\n\s*WHERE id = TRUE\s*\n\s*FOR UPDATE/);
});

test("migrations-11 — enrollment's boundary read is locked BEFORE the cap-check update (same transaction ordering)", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  const enrollFn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION t002_try_enroll"),
    sql.indexOf("CREATE OR REPLACE FUNCTION t002_activate_body_completeness_boundary")
  );
  const forUpdateIdx = enrollFn.indexOf("FOR UPDATE");
  const capCheckIdx = enrollFn.indexOf("SET enrolled_count = enrolled_count + 1");
  assert.ok(forUpdateIdx >= 0 && capCheckIdx >= 0);
  assert.ok(forUpdateIdx < capCheckIdx, "the boundary lock must be acquired before the cap check");
});

test("migrations-11 — duplicate-enrollment protection (ON CONFLICT DO NOTHING) is preserved unchanged", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  assert.match(sql, /INSERT INTO t002_observations \(proposal_id\)\s*\n\s*VALUES \(p_proposal_id\)\s*\n\s*ON CONFLICT \(proposal_id\) DO NOTHING/);
});

// ── Documentation content checks ──────────────────────────────────────────────

test("docs/experiments/T-002.md — contains the pre-enrollment amendment language verbatim", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  assert.match(
    doc,
    /Before the first observation enrolled, T-002 was amended to begin only after\s*\n?>?\s*body-completeness provenance was deployed/
  );
  assert.match(doc, /enrollment_count = 0/);
  assert.match(doc, /locked cap,\s*\n?>?\s*hypotheses, thresholds, and outcome definitions were unchanged/);
});

test("docs/experiments/T-002.md — states the fixed boundary and orthogonal-dimension language verbatim", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  assert.match(doc, /Phase-one enrollment begins at the fixed body-completeness deployment\s*\n?>?\s*boundary/);
  assert.match(
    doc,
    /content_completeness.*and.*locally_truncated.*are stored as separate\s*\n?>?\s*orthogonal dimensions/
  );
  assert.match(doc, /derived views, not stored states/);
});

test("docs/experiments/T-002.md — states responsiveness-vs-correctness limitation verbatim", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  assert.match(
    doc,
    /Aggregate responsiveness metrics must be interpreted alongside source\s*\n?>?\s*completeness/
  );
  assert.match(
    doc,
    /does not establish that Tacit routed the\s*\n?>?\s*correct item or produced correct proposal content/
  );
});

test("docs/experiments/T-002.md — states the three-condition production-verification requirement", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  assert.match(doc, /enrolled_count = 0/);
  assert.match(doc, /zero rows in `t002_observations`/);
  assert.match(doc, /boundary is not already set|not already set/);
  assert.match(doc, /activation must stop and the protocol\s*\nconflict must be reported/);
});

test("docs/experiments/T-002.md — documents the corrected 10-step deployment order", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  assert.match(doc, /1\. Apply `migrations-10-gmail-body-provenance\.sql`/);
  assert.match(doc, /2\. Apply `migrations-11-t002-body-completeness-boundary\.sql`/);
  assert.match(doc, /3\. Leave `body_completeness_boundary_at` `NULL`/);
  assert.match(doc, /4\. Deploy the new application code/);
  assert.match(doc, /5\. While the boundary is still `NULL`, verify in production/);
  assert.match(doc, /6\. Query production and confirm all three preconditions still hold/);
  assert.match(doc, /7\. Call `t002_activate_body_completeness_boundary\(\)` exactly once/);
  assert.match(doc, /8\. Verify the stored boundary timestamp/);
  assert.match(doc, /9\. Confirm the first eligible proposal created on or after the boundary/);
  assert.match(doc, /10\. Confirm proposals created before the boundary never enroll/);
});

test("docs/experiments/T-002.md — activation step comes strictly after application-code deployment, not before", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  const deployStepIdx = doc.indexOf("4. Deploy the new application code");
  const activateStepIdx = doc.indexOf("7. Call `t002_activate_body_completeness_boundary()` exactly once");
  assert.ok(deployStepIdx > 0 && activateStepIdx > 0);
  assert.ok(
    deployStepIdx < activateStepIdx,
    "application-code deployment must be documented before boundary activation — this is the contamination defect that was fixed"
  );
});

test("docs/experiments/T-002.md — contains the explicit pre-activation warning verbatim", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  assert.match(
    doc,
    /Do not activate the enrollment boundary before the provenance-writing\s*\n?>?\s*application code is deployed and verified\. Activation before deployment\s*\n?>?\s*can admit post-boundary proposals with legacy\/unknown source\s*\n?>?\s*completeness\./
  );
});

test("docs/experiments/T-002.md — documents that boundary NULL blocks every automatic t002_try_enroll call during the deploy window", async () => {
  const doc = await readRepoFile("docs", "experiments", "T-002.md");
  assert.match(doc, /GET \/api\/cron\/watch/);
  assert.match(
    doc,
    /No code path — cron-triggered or otherwise — can enroll a proposal while the\s*\n?boundary is unset/
  );
});

test("migrations-11 — activation function's own comment warns against activating before app-code deployment", async () => {
  const sql = await readRepoFile("supabase", "migrations-11-t002-body-completeness-boundary.sql");
  assert.match(sql, /Do not call this until AFTER the provenance-writing application code/);
});

// ── Dashboard static check ────────────────────────────────────────────────────

test("view.tsx — every Source completeness Stat shows numerator/denominator via fmtGroup, never a bare count", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    resolve(here, "..", "app", "experiments", "t002", "view.tsx"),
    "utf-8"
  );
  const sectionStart = source.indexOf('title="Source completeness"');
  const sectionEnd = source.indexOf("</Section>", sectionStart);
  assert.ok(sectionStart > 0 && sectionEnd > sectionStart);
  const section = source.slice(sectionStart, sectionEnd);
  const statValueMatches = [...section.matchAll(/<Stat\s/g)];
  assert.ok(statValueMatches.length >= 11, "expected all raw + derived provenance groups to be rendered");
  assert.ok(!/value=\{metrics\.provenance\.\w+\}(?!\s*,)/.test(section), "a provenance count must never be rendered as a bare value");
  const fmtGroupCalls = [...section.matchAll(/fmtGroup\(/g)];
  assert.equal(fmtGroupCalls.length, statValueMatches.length);
});
