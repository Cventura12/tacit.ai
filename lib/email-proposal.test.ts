import { test } from "node:test";
import assert from "node:assert/strict";
import { countGenuineSources, resolveReplyRequiredForInsert } from "./email-proposal.ts";

// ── countGenuineSources ────────────────────────────────────────────────────────
// Origin: a live report that "Every claim traces to a cited page" appeared with
// zero relevant internal documents. The component's own conditional logic was
// already correct as of the prior fix, but sourceCount trusted
// matched_documents blindly as a well-formed array. These tests prove stale,
// null, or malformed grounded-source data can never produce a count > 0.

test("countGenuineSources — an empty array is zero", () => {
  assert.equal(countGenuineSources([]), 0);
});

test("countGenuineSources — null is zero, never throws", () => {
  assert.equal(countGenuineSources(null), 0);
});

test("countGenuineSources — undefined is zero, never throws", () => {
  assert.equal(countGenuineSources(undefined), 0);
});

test("countGenuineSources — a non-array value (stale/malformed data) is zero, never throws", () => {
  assert.equal(countGenuineSources("not an array"), 0);
  assert.equal(countGenuineSources(42), 0);
  assert.equal(countGenuineSources({}), 0);
});

test("countGenuineSources — an array of well-formed documents counts correctly", () => {
  assert.equal(
    countGenuineSources([
      { doc_id: "1", title: "Housing Guide", page: 1, snippet: "s" },
      { doc_id: "2", title: "Application FAQ", page: 2, snippet: "s" },
    ]),
    2
  );
});

test("countGenuineSources — entries with no title, an empty title, or a whitespace-only title do not count", () => {
  assert.equal(countGenuineSources([{ page: 1, snippet: "s" }]), 0);
  assert.equal(countGenuineSources([{ title: "", page: 1, snippet: "s" }]), 0);
  assert.equal(countGenuineSources([{ title: "   ", page: 1, snippet: "s" }]), 0);
});

test("countGenuineSources — null/undefined entries inside the array are skipped, not counted, never throw", () => {
  assert.equal(countGenuineSources([null, undefined, { title: "Real Doc", page: 1, snippet: "s" }]), 1);
});

test("countGenuineSources — a mix of genuine and malformed entries counts only the genuine ones", () => {
  assert.equal(
    countGenuineSources([
      { title: "Real Doc", page: 1, snippet: "s" },
      { title: "" },
      null,
      "not an object",
      { title: "Another Real Doc", page: 2, snippet: "s" },
    ]),
    2
  );
});

// ── resolveReplyRequiredForInsert ─────────────────────────────────────────────
// Origin: pending_proposals gained a nullable reply_required column
// (migrations-12) with no DEFAULT and no backfill. This is the single place
// lib/inbox-watch.ts decides what to write for a NEW row — it must pass
// through a genuine false unchanged (never upgrade it to true just because
// the proposal is "actionable") and must never fabricate true or false for a
// missing/malformed value.

test("resolveReplyRequiredForInsert — a genuine false is passed through unchanged, never upgraded to true", () => {
  assert.equal(resolveReplyRequiredForInsert(false), false);
});

test("resolveReplyRequiredForInsert — a genuine true is passed through unchanged", () => {
  assert.equal(resolveReplyRequiredForInsert(true), true);
});

test("resolveReplyRequiredForInsert — undefined (missing field) becomes null, never a fabricated true", () => {
  assert.equal(resolveReplyRequiredForInsert(undefined), null);
});

test("resolveReplyRequiredForInsert — a malformed non-boolean value becomes null, never a fabricated default", () => {
  assert.equal(resolveReplyRequiredForInsert("true"), null);
  assert.equal(resolveReplyRequiredForInsert(1), null);
  assert.equal(resolveReplyRequiredForInsert(null), null);
});
