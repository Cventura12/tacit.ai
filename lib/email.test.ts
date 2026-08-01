import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretResendResult } from "./t002.ts";

test("interpretResendResult — accepted when Resend returns an id and no error", () => {
  const result = interpretResendResult({ data: { id: "abc123" }, error: null });
  assert.deepEqual(result, { accepted: true, id: "abc123" });
});

test("interpretResendResult — not accepted when Resend returns an error", () => {
  const result = interpretResendResult({ data: null, error: { message: "invalid_from_address" } });
  assert.equal(result.accepted, false);
  assert.equal(result.id, undefined);
});

test("interpretResendResult — not accepted when response is empty (no id, no error)", () => {
  // Defensive case: never assume acceptance just because nothing threw.
  const result = interpretResendResult({});
  assert.equal(result.accepted, false);
});

test("interpretResendResult — never labels acceptance as delivery", () => {
  const result = interpretResendResult({ data: { id: "abc123" }, error: null });
  assert.ok(!("delivered" in result));
});
