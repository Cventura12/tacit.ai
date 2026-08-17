import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateMemory,
  buildPastedCandidateWriteInput,
  planPastedCandidateWrites,
  MAX_EXCERPT_LEN,
  type PastedTextSource,
  type ExtractedCandidate,
  type ExistingMemoryClaim,
} from "./policy.ts";

// All pure planning logic for lib/memory/extract_pasted.ts's
// extractPastedCandidates lives in policy.ts (no I/O, no @/-aliased
// imports) and is tested here directly — the same split as
// lib/memory/extract.test.ts for the owner-stated write-back path. The LLM
// extraction call and the live dedup lookup (both I/O) are proven live
// against a real database and a real model call — see this task's summary,
// including the end-to-end proof that a confirmed candidate is retrievable
// by the Phase 1 ask route.

const SOURCE: PastedTextSource = {
  ownerId: "user_caleb",
  sourceId: "paste-abc123",
  label: "session 2026-08-12",
  extractedAt: "2026-08-12T03:00:00.000Z",
};

// ── findDuplicateMemory ─────────────────────────────────────────────────────────

test("findDuplicateMemory — exact match (case/whitespace-insensitive) returns the existing memory", () => {
  const existing: ExistingMemoryClaim[] = [{ id: "mem-1", claim: "moving to Austin in the fall" }];
  const match = findDuplicateMemory("Moving   to austin in the Fall", existing);
  assert.deepEqual(match, { id: "mem-1", claim: "moving to Austin in the fall" });
});

test("findDuplicateMemory — no match returns null", () => {
  const existing: ExistingMemoryClaim[] = [{ id: "mem-1", claim: "unrelated claim" }];
  assert.equal(findDuplicateMemory("moving to Austin", existing), null);
});

test("findDuplicateMemory — empty existing list always returns null", () => {
  assert.equal(findDuplicateMemory("any claim", []), null);
});

test("findDuplicateMemory — a differently-worded but semantically similar claim is NOT caught (same known v1 limitation as isDuplicateClaim)", () => {
  const existing: ExistingMemoryClaim[] = [{ id: "mem-1", claim: "moving to Austin this fall" }];
  assert.equal(findDuplicateMemory("relocating to Austin in October", existing), null);
});

// ── buildPastedCandidateWriteInput ────────────────────────────────────────────

test("buildPastedCandidateWriteInput — maps to memory_type='inferred_candidate', source_kind='conversation'", () => {
  const input = buildPastedCandidateWriteInput("moving to Austin in the fall", "I'm moving to Austin in the fall.", SOURCE);
  assert.equal(input.memory_type, "inferred_candidate");
  assert.equal(input.source_kind, "conversation");
  assert.equal(input.source_id, "paste-abc123");
  assert.equal(input.owner_id, "user_caleb");
  assert.equal(input.claim, "moving to Austin in the fall");
});

test("buildPastedCandidateWriteInput — source_locator carries label, timestamp, and the excerpt", () => {
  const input = buildPastedCandidateWriteInput("claim text", "the exact sentence", SOURCE);
  assert.deepEqual(input.source_locator, {
    label: "session 2026-08-12",
    extracted_at: "2026-08-12T03:00:00.000Z",
    excerpt: "the exact sentence",
  });
});

test("buildPastedCandidateWriteInput — label defaults to null when omitted", () => {
  const input = buildPastedCandidateWriteInput("claim", "excerpt", {
    ownerId: "user_caleb",
    sourceId: "paste-1",
    extractedAt: "2026-08-12T03:00:00.000Z",
  });
  assert.equal((input.source_locator as { label: unknown }).label, null);
});

test("buildPastedCandidateWriteInput — excerpt is clamped to MAX_EXCERPT_LEN, never stored longer than that", () => {
  const longExcerpt = "x".repeat(MAX_EXCERPT_LEN + 500);
  const input = buildPastedCandidateWriteInput("claim", longExcerpt, SOURCE);
  const locator = input.source_locator as { excerpt: string };
  assert.equal(locator.excerpt.length, MAX_EXCERPT_LEN);
});

test("buildPastedCandidateWriteInput — has no confirmation_status field at all (derived downstream by buildMemoryInsertRow, always lands unconfirmed)", () => {
  const input = buildPastedCandidateWriteInput("claim", "excerpt", SOURCE) as unknown as Record<string, unknown>;
  assert.equal("confirmation_status" in input, false);
});

test("buildPastedCandidateWriteInput — rejects an empty claim", () => {
  assert.throws(() => buildPastedCandidateWriteInput("", "excerpt", SOURCE), /claim/);
});

test("buildPastedCandidateWriteInput — rejects missing ownerId", () => {
  assert.throws(
    () => buildPastedCandidateWriteInput("claim", "excerpt", { ownerId: "", sourceId: "p-1", extractedAt: "t" }),
    /ownerId/
  );
});

test("buildPastedCandidateWriteInput — rejects missing sourceId", () => {
  assert.throws(
    () => buildPastedCandidateWriteInput("claim", "excerpt", { ownerId: "user_caleb", sourceId: "", extractedAt: "t" }),
    /sourceId/
  );
});

// ── planPastedCandidateWrites ─────────────────────────────────────────────────

test("planPastedCandidateWrites — an empty extraction writes nothing and reports nothing already known", () => {
  const plan = planPastedCandidateWrites([], [], SOURCE);
  assert.deepEqual(plan.toWrite, []);
  assert.deepEqual(plan.alreadyKnown, []);
});

test("planPastedCandidateWrites — a genuinely new candidate is planned for writing, carrying its reason", () => {
  const candidates: ExtractedCandidate[] = [
    { claim: "moving to Austin in the fall", reason: "stated as a direction", excerpt: "I'm moving to Austin in the fall." },
  ];
  const plan = planPastedCandidateWrites(candidates, [], SOURCE);
  assert.equal(plan.toWrite.length, 1);
  assert.equal(plan.toWrite[0].input.claim, "moving to Austin in the fall");
  assert.equal(plan.toWrite[0].reason, "stated as a direction");
  assert.deepEqual(plan.alreadyKnown, []);
});

test("planPastedCandidateWrites — a candidate matching an existing memory is reported in alreadyKnown, not written, and not silently dropped", () => {
  const candidates: ExtractedCandidate[] = [
    { claim: "Moving to austin in the FALL", reason: "stated as a direction", excerpt: "..." },
  ];
  const existing: ExistingMemoryClaim[] = [{ id: "mem-1", claim: "moving to austin in the fall" }];
  const plan = planPastedCandidateWrites(candidates, existing, SOURCE);
  assert.deepEqual(plan.toWrite, []);
  assert.equal(plan.alreadyKnown.length, 1);
  assert.deepEqual(plan.alreadyKnown[0], {
    claim: "Moving to austin in the FALL",
    reason: "stated as a direction",
    existing_id: "mem-1",
    existing_claim: "moving to austin in the fall",
  });
});

test("planPastedCandidateWrites — mixed batch: new candidates written, duplicates reported separately, independently", () => {
  const candidates: ExtractedCandidate[] = [
    { claim: "new claim one", reason: "reason A", excerpt: "excerpt A" },
    { claim: "already known claim", reason: "reason B", excerpt: "excerpt B" },
    { claim: "new claim two", reason: "reason C", excerpt: "excerpt C" },
  ];
  const existing: ExistingMemoryClaim[] = [{ id: "mem-9", claim: "Already Known Claim" }];
  const plan = planPastedCandidateWrites(candidates, existing, SOURCE);
  assert.equal(plan.toWrite.length, 2);
  assert.deepEqual(plan.toWrite.map((w) => w.input.claim), ["new claim one", "new claim two"]);
  assert.equal(plan.alreadyKnown.length, 1);
  assert.equal(plan.alreadyKnown[0].existing_id, "mem-9");
});

test("planPastedCandidateWrites — every planned write carries memory_type='inferred_candidate' and the given source", () => {
  const candidates: ExtractedCandidate[] = [
    { claim: "claim a", reason: "r", excerpt: "e" },
    { claim: "claim b", reason: "r", excerpt: "e" },
  ];
  const plan = planPastedCandidateWrites(candidates, [], SOURCE);
  for (const { input } of plan.toWrite) {
    assert.equal(input.memory_type, "inferred_candidate");
    assert.equal(input.source_id, SOURCE.sourceId);
    assert.equal(input.owner_id, SOURCE.ownerId);
  }
});
