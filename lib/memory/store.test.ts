import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_TYPES,
  SOURCE_KINDS,
  buildMemoryInsertRow,
  isUnconfirmedCandidate,
  type WriteMemoryInput,
} from "./policy.ts";

// ── Fixture: a minimal, otherwise-valid input, overridden per test ──────────

function validInput(overrides: Partial<WriteMemoryInput> = {}): WriteMemoryInput {
  return {
    owner_id: "user_caleb",
    claim: "lease ends 2026-05-01",
    memory_type: "observed",
    source_kind: "document",
    source_id: "doc-123",
    ...overrides,
  };
}

// ── memory_type -> confirmation_status derivation ────────────────────────────

test("buildMemoryInsertRow — 'observed' with a valid source persists as 'confirmed'", () => {
  const row = buildMemoryInsertRow(validInput({ memory_type: "observed" }));
  assert.equal(row.confirmation_status, "confirmed");
});

test("buildMemoryInsertRow — 'owner_stated' persists as 'confirmed'", () => {
  const row = buildMemoryInsertRow(
    validInput({ memory_type: "owner_stated", source_kind: "conversation", source_id: "run-9" })
  );
  assert.equal(row.confirmation_status, "confirmed");
});

test("buildMemoryInsertRow — 'inferred_candidate' persists as 'unconfirmed'", () => {
  const row = buildMemoryInsertRow(
    validInput({ memory_type: "inferred_candidate", source_kind: "email", source_id: "msg-1" })
  );
  assert.equal(row.confirmation_status, "unconfirmed");
});

// ── No sourceless memories, for every memory_type ────────────────────────────

for (const memory_type of MEMORY_TYPES) {
  test(`buildMemoryInsertRow — ${memory_type}: missing source_kind is rejected`, () => {
    const input = validInput({ memory_type });
    // @ts-expect-error — deliberately omitting a required field to prove the
    // runtime check, not just the type, rejects it.
    delete input.source_kind;
    assert.throws(() => buildMemoryInsertRow(input), /source_kind/);
  });

  test(`buildMemoryInsertRow — ${memory_type}: missing source_id is rejected`, () => {
    const input = validInput({ memory_type });
    // @ts-expect-error — deliberately omitting a required field to prove the
    // runtime check, not just the type, rejects it.
    delete input.source_id;
    assert.throws(() => buildMemoryInsertRow(input), /source_id/);
  });

  test(`buildMemoryInsertRow — ${memory_type}: empty-string source_id is rejected`, () => {
    const input = validInput({ memory_type, source_id: "" });
    assert.throws(() => buildMemoryInsertRow(input), /source_id/);
  });
}

// ── owner_id is required, no default/fallback ────────────────────────────────

test("buildMemoryInsertRow — missing owner_id is rejected", () => {
  const input = validInput();
  // @ts-expect-error — deliberately omitting a required field to prove the
  // runtime check, not just the type, rejects it.
  delete input.owner_id;
  assert.throws(() => buildMemoryInsertRow(input), /owner_id/);
});

test("buildMemoryInsertRow — empty-string owner_id is rejected", () => {
  assert.throws(() => buildMemoryInsertRow(validInput({ owner_id: "" })), /owner_id/);
});

// ── A caller cannot force an inconsistent confirmation_status ────────────────

test("buildMemoryInsertRow — a forced confirmation_status on the input is ignored; the row is still derived from memory_type", () => {
  const input = validInput({ memory_type: "observed" }) as WriteMemoryInput & {
    confirmation_status: string;
  };
  // WriteMemoryInput has no confirmation_status field at all — this
  // simulates a caller bypassing the type system (e.g. via `as any`) to try
  // to inject one anyway.
  input.confirmation_status = "unconfirmed";
  const row = buildMemoryInsertRow(input);
  assert.equal(row.confirmation_status, "confirmed", "an 'observed' write must never persist 'unconfirmed'");
});

test("buildMemoryInsertRow — a forced confirmation_status cannot promote an inferred_candidate to confirmed", () => {
  const input = validInput({
    memory_type: "inferred_candidate",
    source_kind: "email",
    source_id: "msg-1",
  }) as WriteMemoryInput & { confirmation_status: string };
  input.confirmation_status = "confirmed";
  const row = buildMemoryInsertRow(input);
  assert.equal(row.confirmation_status, "unconfirmed", "an inferred_candidate must never persist 'confirmed'");
});

// ── Other validity checks ─────────────────────────────────────────────────────

test("buildMemoryInsertRow — missing claim is rejected", () => {
  const input = validInput({ claim: "" });
  assert.throws(() => buildMemoryInsertRow(input), /claim/);
});

test("buildMemoryInsertRow — whitespace-only claim is rejected", () => {
  const input = validInput({ claim: "   " });
  assert.throws(() => buildMemoryInsertRow(input), /claim/);
});

test("buildMemoryInsertRow — an invalid memory_type is rejected", () => {
  const input = validInput() as WriteMemoryInput;
  // @ts-expect-error — deliberately invalid to prove the runtime check.
  input.memory_type = "bogus_type";
  assert.throws(() => buildMemoryInsertRow(input), /memory_type/);
});

test("buildMemoryInsertRow — an invalid source_kind is rejected", () => {
  const input = validInput() as WriteMemoryInput;
  // @ts-expect-error — deliberately invalid to prove the runtime check.
  input.source_kind = "carrier_pigeon";
  assert.throws(() => buildMemoryInsertRow(input), /source_kind/);
});

// ── Passthrough fields ────────────────────────────────────────────────────────

test("buildMemoryInsertRow — source_locator/confidence/valid_until default to null when omitted", () => {
  const row = buildMemoryInsertRow(validInput());
  assert.equal(row.source_locator, null);
  assert.equal(row.confidence, null);
  assert.equal(row.valid_until, null);
});

test("buildMemoryInsertRow — source_locator/confidence/valid_until pass through when provided", () => {
  const row = buildMemoryInsertRow(
    validInput({
      source_locator: { page: 3, span: [10, 40] },
      confidence: 0.87,
      valid_until: "2027-01-01T00:00:00.000Z",
    })
  );
  assert.deepEqual(row.source_locator, { page: 3, span: [10, 40] });
  assert.equal(row.confidence, 0.87);
  assert.equal(row.valid_until, "2027-01-01T00:00:00.000Z");
});

test("MEMORY_TYPES and SOURCE_KINDS match the CHECK constraints in supabase/migrations-13-memories.sql", () => {
  assert.deepEqual([...MEMORY_TYPES], ["observed", "owner_stated", "inferred_candidate"]);
  assert.deepEqual([...SOURCE_KINDS], ["document", "email", "conversation"]);
});

// ── isUnconfirmedCandidate — the shared confirm/reject eligibility rule ──────
//
// lib/memory/store.ts's confirmCandidate/rejectCandidate call this directly
// against a freshly fetched, owner-scoped row before issuing their UPDATE —
// see supersedeMemory/confirmCandidate/rejectCandidate in store.ts, which
// cannot be imported here (it pulls in @/lib/db, unresolvable by Node's
// native test runner without a bundler — same reason tool-log-summary.ts and
// handle_email_grounding.ts stay import-free, see this file's header
// comment). The actual DB-backed behavior of confirmCandidate/rejectCandidate
// — including that ineligible rows are rejected with zero side effects — is
// proven live against a real database; see this task's summary for that
// verification. This section covers the eligibility RULE itself in
// isolation, for every row shape it must accept or reject.

test("isUnconfirmedCandidate — an unconfirmed inferred_candidate is eligible", () => {
  assert.equal(
    isUnconfirmedCandidate({ memory_type: "inferred_candidate", confirmation_status: "unconfirmed" }),
    true
  );
});

test("isUnconfirmedCandidate — an 'observed' row is never eligible, regardless of confirmation_status", () => {
  assert.equal(
    isUnconfirmedCandidate({ memory_type: "observed", confirmation_status: "confirmed" }),
    false
  );
});

test("isUnconfirmedCandidate — an 'owner_stated' row is never eligible", () => {
  assert.equal(
    isUnconfirmedCandidate({ memory_type: "owner_stated", confirmation_status: "confirmed" }),
    false
  );
});

test("isUnconfirmedCandidate — an already-confirmed inferred_candidate is no longer eligible", () => {
  assert.equal(
    isUnconfirmedCandidate({ memory_type: "inferred_candidate", confirmation_status: "confirmed" }),
    false
  );
});

test("isUnconfirmedCandidate — an already-rejected inferred_candidate is no longer eligible", () => {
  assert.equal(
    isUnconfirmedCandidate({ memory_type: "inferred_candidate", confirmation_status: "rejected" }),
    false
  );
});
