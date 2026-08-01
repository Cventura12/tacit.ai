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
