import { test } from "node:test";
import assert from "node:assert/strict";
import { decideMarkStatusOutcome } from "./inbox-client.ts";

test("decideMarkStatusOutcome — ok response removes the proposal, no reload, no error", () => {
  const outcome = decideMarkStatusOutcome(true, 200, { error: undefined });
  assert.deepEqual(outcome, { shouldRemove: true, shouldReload: false, errorMessage: null });
});

test("decideMarkStatusOutcome — 409 does not remove the proposal, and triggers a reload", () => {
  const outcome = decideMarkStatusOutcome(false, 409, {
    error: "Proposal is no longer pending",
    code: "PROPOSAL_NOT_PENDING",
  });
  assert.equal(outcome.shouldRemove, false);
  assert.equal(outcome.shouldReload, true);
  assert.equal(outcome.errorMessage, "Proposal is no longer pending");
});

test("decideMarkStatusOutcome — 409 with no body still reloads with a fallback message", () => {
  const outcome = decideMarkStatusOutcome(false, 409, null);
  assert.equal(outcome.shouldRemove, false);
  assert.equal(outcome.shouldReload, true);
  assert.ok(outcome.errorMessage);
});

test("decideMarkStatusOutcome — a 500 does not remove the proposal and does not reload", () => {
  const outcome = decideMarkStatusOutcome(false, 500, { error: "Update failed" });
  assert.equal(outcome.shouldRemove, false);
  assert.equal(outcome.shouldReload, false);
  assert.equal(outcome.errorMessage, "Update failed");
});
