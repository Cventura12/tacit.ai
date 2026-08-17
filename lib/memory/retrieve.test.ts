import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchMemoriesParams } from "./policy.ts";

// buildSearchMemoriesParams is the read-path counterpart to
// buildMemoryInsertRow (see store.test.ts) — pure, no I/O, testable directly.
// The actual EXCLUSION FILTER (superseded/revoked/unconfirmed/cross-owner/
// stale) lives entirely in search_memories()'s SQL WHERE clause (see
// supabase/migrations-14-memories-search.sql) and cannot be exercised here —
// see this task's live-verification summary for that proof against a real
// database. What's covered here is everything the TypeScript layer is
// actually responsible for: input validation and locking p_include_stale to
// false unconditionally.

test("buildSearchMemoriesParams — valid input builds the expected RPC params", () => {
  const params = buildSearchMemoriesParams("user_caleb", "lease renewal", 5);
  assert.deepEqual(params, {
    q: "lease renewal",
    p_owner_id: "user_caleb",
    lim: 5,
    p_include_stale: false,
  });
});

test("buildSearchMemoriesParams — limit defaults to 8 when omitted", () => {
  const params = buildSearchMemoriesParams("user_caleb", "lease renewal");
  assert.equal(params.lim, 8);
});

test("buildSearchMemoriesParams — missing owner_id is rejected", () => {
  assert.throws(() => buildSearchMemoriesParams("", "lease renewal"), /owner_id/);
});

test("buildSearchMemoriesParams — missing query is rejected", () => {
  assert.throws(() => buildSearchMemoriesParams("user_caleb", ""), /query/);
});

test("buildSearchMemoriesParams — whitespace-only query is rejected", () => {
  assert.throws(() => buildSearchMemoriesParams("user_caleb", "   "), /query/);
});

test("buildSearchMemoriesParams — p_include_stale is always false, with no way to override it", () => {
  const params = buildSearchMemoriesParams("user_caleb", "lease renewal");
  assert.equal(params.p_include_stale, false);
  // buildSearchMemoriesParams has no parameter for it at all — there is no
  // fourth argument a caller could pass to flip this, forced or otherwise.
  assert.equal(buildSearchMemoriesParams.length, 3);
});
