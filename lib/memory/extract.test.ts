import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeClaim,
  isDuplicateClaim,
  buildOwnerStatedWriteInput,
  planOwnerStatedWrites,
  type OwnerStatedSource,
} from "./policy.ts";

// All pure planning logic for lib/memory/extract.ts's
// extractOwnerStatedMemories lives in policy.ts (no I/O, no @/-aliased
// imports — see that file's header) and is tested here directly. The LLM
// extraction call and the live dedup lookup (both I/O) cannot be exercised
// by Node's native test runner without a bundler — see this task's summary
// for the live verification against a real database and a real model call.

const SOURCE: OwnerStatedSource = {
  ownerId: "user_caleb",
  sourceGmailMessageId: "msg-sent-123",
  threadId: "thread-456",
  inReplyToId: "msg-original-789",
};

// ── normalizeClaim ────────────────────────────────────────────────────────────

test("normalizeClaim — lowercases, trims, and collapses internal whitespace", () => {
  assert.equal(normalizeClaim("  Confirmed   Attendance  At The Meeting  "), "confirmed attendance at the meeting");
});

test("normalizeClaim — identical text after normalization from different casing/spacing", () => {
  assert.equal(
    normalizeClaim("Agreed to the May 1 deadline"),
    normalizeClaim("agreed   to the may 1 deadline")
  );
});

// ── isDuplicateClaim ───────────────────────────────────────────────────────────

test("isDuplicateClaim — exact match (case/whitespace-insensitive) is a duplicate", () => {
  assert.equal(
    isDuplicateClaim("Confirmed attendance at the meeting", ["confirmed   attendance at the meeting"]),
    true
  );
});

test("isDuplicateClaim — a differently-worded but semantically similar claim is NOT caught (known v1 limitation)", () => {
  assert.equal(
    isDuplicateClaim("confirmed attendance on March 3rd", ["confirmed for 3/3"]),
    false
  );
});

test("isDuplicateClaim — no existing claims means never a duplicate", () => {
  assert.equal(isDuplicateClaim("agreed to the deadline", []), false);
});

test("isDuplicateClaim — matches against any one of several existing claims", () => {
  assert.equal(
    isDuplicateClaim("agreed to the deadline", ["unrelated claim", "AGREED TO THE DEADLINE", "another"]),
    true
  );
});

// ── buildOwnerStatedWriteInput — the mapping from an extracted claim to a writeMemory call ──

test("buildOwnerStatedWriteInput — maps to memory_type='owner_stated', source_kind='email', correct source_id", () => {
  const input = buildOwnerStatedWriteInput("agreed to the May 1 deadline", SOURCE);
  assert.equal(input.memory_type, "owner_stated");
  assert.equal(input.source_kind, "email");
  assert.equal(input.source_id, "msg-sent-123");
  assert.equal(input.owner_id, "user_caleb");
  assert.equal(input.claim, "agreed to the May 1 deadline");
});

test("buildOwnerStatedWriteInput — source_locator carries thread_id and in_reply_to_id", () => {
  const input = buildOwnerStatedWriteInput("some claim", SOURCE);
  assert.deepEqual(input.source_locator, { thread_id: "thread-456", in_reply_to_id: "msg-original-789" });
});

test("buildOwnerStatedWriteInput — source_locator fields default to null when omitted", () => {
  const input = buildOwnerStatedWriteInput("some claim", {
    ownerId: "user_caleb",
    sourceGmailMessageId: "msg-1",
  });
  assert.deepEqual(input.source_locator, { thread_id: null, in_reply_to_id: null });
});

test("buildOwnerStatedWriteInput — has no confirmation_status field at all (derived downstream by buildMemoryInsertRow)", () => {
  const input = buildOwnerStatedWriteInput("some claim", SOURCE) as unknown as Record<string, unknown>;
  assert.equal("confirmation_status" in input, false);
});

test("buildOwnerStatedWriteInput — rejects an empty claim", () => {
  assert.throws(() => buildOwnerStatedWriteInput("", SOURCE), /claim/);
});

test("buildOwnerStatedWriteInput — rejects missing ownerId", () => {
  assert.throws(
    () => buildOwnerStatedWriteInput("some claim", { ownerId: "", sourceGmailMessageId: "msg-1" }),
    /ownerId/
  );
});

test("buildOwnerStatedWriteInput — rejects missing sourceGmailMessageId", () => {
  assert.throws(
    () => buildOwnerStatedWriteInput("some claim", { ownerId: "user_caleb", sourceGmailMessageId: "" }),
    /sourceGmailMessageId/
  );
});

// ── planOwnerStatedWrites ──────────────────────────────────────────────────────

test("planOwnerStatedWrites — an empty extraction writes nothing", () => {
  const plan = planOwnerStatedWrites([], [], SOURCE);
  assert.deepEqual(plan.toWrite, []);
  assert.equal(plan.skippedAsDuplicate, 0);
});

test("planOwnerStatedWrites — a genuinely new claim is planned for writing", () => {
  const plan = planOwnerStatedWrites(["agreed to the May 1 deadline"], [], SOURCE);
  assert.equal(plan.toWrite.length, 1);
  assert.equal(plan.toWrite[0].claim, "agreed to the May 1 deadline");
  assert.equal(plan.skippedAsDuplicate, 0);
});

test("planOwnerStatedWrites — a claim already present (normalized) is skipped, not written", () => {
  const plan = planOwnerStatedWrites(
    ["Agreed to the May 1 deadline"],
    ["agreed   to the may 1 deadline"],
    SOURCE
  );
  assert.deepEqual(plan.toWrite, []);
  assert.equal(plan.skippedAsDuplicate, 1);
});

test("planOwnerStatedWrites — mixed batch: new claims are written, duplicates are skipped, independently", () => {
  const plan = planOwnerStatedWrites(
    ["new claim one", "already known claim", "new claim two"],
    ["Already Known Claim"],
    SOURCE
  );
  assert.equal(plan.toWrite.length, 2);
  assert.deepEqual(plan.toWrite.map((w) => w.claim), ["new claim one", "new claim two"]);
  assert.equal(plan.skippedAsDuplicate, 1);
});

test("planOwnerStatedWrites — every planned write carries memory_type='owner_stated' and the given source", () => {
  const plan = planOwnerStatedWrites(["claim a", "claim b"], [], SOURCE);
  for (const input of plan.toWrite) {
    assert.equal(input.memory_type, "owner_stated");
    assert.equal(input.source_id, SOURCE.sourceGmailMessageId);
    assert.equal(input.owner_id, SOURCE.ownerId);
  }
});
