// Write, correction, and revocation path for Tacit's memory store — prompt
// 3 of 4 (1: schema → 2: write path → 3: correction/revocation [this file] →
// 4: read path). This module creates, supersedes, revokes, and confirms/
// rejects memory rows. There is still no read/search/retrieval path — that
// is prompt 4 — and nothing in the app calls into this module yet. Mutating
// a memory here has zero effect on any agent, tool, prompt, or route until a
// read path exists that actually consults these rows.
//
// The write POLICY itself (required fields, how confirmation_status is
// derived from memory_type, and the confirm/reject eligibility rule) lives
// in ./policy.ts, kept free of @/-aliased imports so it's directly
// unit-testable — see lib/memory/store.test.ts. This file adds the actual
// database operations on top of that policy.
//
// APPEND-ONLY, BY DESIGN: nothing in this module ever UPDATEs a memory's
// claim, memory_type, source_kind, source_id, source_locator, or confidence
// — the columns that describe WHAT was believed and WHERE it came from.
// Only three things ever change on an existing row: superseded_by (set once,
// by supersedeMemory), revoked_at (set by revokeMemory), and
// confirmation_status (set by confirmCandidate/rejectCandidate, and only
// while it's still 'unconfirmed'). Correction is supersession by pointer;
// deletion is a tombstone. History is never destroyed.

import { getDb, isDbConfigured } from "@/lib/db";
import {
  buildMemoryInsertRow,
  isUnconfirmedCandidate,
  type ConfirmationStatus,
  type MemoryType,
  type SourceKind,
  type WriteMemoryInput,
} from "./policy";

export type { WriteMemoryInput };

export interface MemoryRecord {
  id: string;
  owner_id: string;
  claim: string;
  memory_type: MemoryType;
  source_kind: SourceKind;
  source_id: string;
  source_locator: unknown;
  confidence: number | null;
  confirmation_status: ConfirmationStatus;
  valid_until: string | null;
  superseded_by: string | null;
  revoked_at: string | null;
  created_at: string;
}

const MEMORY_COLUMNS =
  "id, owner_id, claim, memory_type, source_kind, source_id, source_locator, confidence, confirmation_status, valid_until, superseded_by, revoked_at, created_at";

function requireDb() {
  if (!isDbConfigured()) throw new Error("Database is not configured");
  return getDb();
}

// Creates exactly one memory row. Throws on invalid input (see
// buildMemoryInsertRow in ./policy.ts) or on a DB failure; returns the
// persisted row on success.
export async function writeMemory(input: WriteMemoryInput): Promise<MemoryRecord> {
  const row = buildMemoryInsertRow(input);

  const db = requireDb();
  const { data, error } = await db
    .from("memories")
    .insert(row)
    .select(MEMORY_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to write memory (memory_type=${input.memory_type}): ${error.message}`);
  }

  const memory = data as MemoryRecord;

  // Counts/ids/type/status only — never claim text, source content,
  // confidence, or locator contents.
  console.log(
    `[memory] id=${memory.id} memory_type=${memory.memory_type} confirmation_status=${memory.confirmation_status} action=write`
  );

  return memory;
}

// Fetches a row scoped to BOTH id and owner_id — a mismatch on either is
// indistinguishable from "doesn't exist," which is the correct behavior:
// this must never leak whether a given id belongs to a different owner.
async function fetchOwnedMemory(
  db: ReturnType<typeof getDb>,
  id: string,
  owner_id: string
): Promise<MemoryRecord | null> {
  const { data, error } = await db
    .from("memories")
    .select(MEMORY_COLUMNS)
    .eq("id", id)
    .eq("owner_id", owner_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up memory ${id}: ${error.message}`);
  }
  return (data as MemoryRecord | null) ?? null;
}

// ── Supersession — correction by pointer, never by edit ──────────────────────
//
// Writes a NEW memory through the existing write policy (writeMemory) — the
// replacement obeys the exact same rules as any other write, including
// confirmation_status derivation from its own memory_type — then points the
// OLD row at it via superseded_by. The old row's own columns, including its
// claim, are never touched. Both rows remain, forever: this IS the
// correction mechanism. newInput deliberately has no owner_id field of its
// own (Omit below) — the owner_id parameter is the single source of truth
// for which owner both the lookup and the replacement write are scoped to,
// so there is no way for a caller to accidentally supersede owner A's memory
// with a row written under owner B.
//
// TRANSACTIONAL INTEGRITY: the Supabase client used here (PostgREST over
// HTTP) has no multi-statement transaction spanning two separate
// .from(...).insert()/.update() calls — each is its own request. True
// atomicity would require a Postgres function wrapping both writes in one
// transaction, which is out of scope for this task (no new migration here).
// Given that constraint, two failure-handling strategies were available once
// the new row is written but before the old row is linked:
//   (a) attempt a compensating delete of the just-written new row, or
//   (b) leave the new row in place and fail loudly, naming both ids.
// (a) was rejected: this store is append-only by design (see module header)
// — a hard delete to "undo" a write would violate the very guarantee this
// correction mechanism exists to uphold, and the delete call could itself
// fail, trading one partial-failure mode for another rather than removing
// it. (b) is what's implemented below. The ordering (write new, THEN link
// old) also bounds the reachable inconsistent state to exactly one shape —
// "a new row exists but no old row points at it yet" — never "an old row
// points at a new row that doesn't exist." A future read path (prompt 4)
// can detect that shape (an unlinked orphan) if it needs to; it can never
// happen the other way around.
export async function supersedeMemory(
  oldId: string,
  newInput: Omit<WriteMemoryInput, "owner_id">,
  owner_id: string
): Promise<{ old: MemoryRecord; superseding: MemoryRecord }> {
  if (!owner_id) throw new Error("supersedeMemory requires owner_id");
  if (!oldId) throw new Error("supersedeMemory requires oldId");

  const db = requireDb();

  // Verify the old row exists and belongs to owner_id BEFORE writing
  // anything — a cross-owner (or missing-id) supersede must fail with zero
  // side effects, not just leave the old row unlinked.
  const oldRow = await fetchOwnedMemory(db, oldId, owner_id);
  if (!oldRow) {
    throw new Error(`supersedeMemory: no memory ${oldId} owned by this owner`);
  }

  const superseding = await writeMemory({ ...newInput, owner_id });

  const { data: updatedOld, error: linkError } = await db
    .from("memories")
    .update({ superseded_by: superseding.id })
    .eq("id", oldId)
    .eq("owner_id", owner_id)
    .select(MEMORY_COLUMNS)
    .single();

  if (linkError || !updatedOld) {
    throw new Error(
      `supersedeMemory: wrote replacement memory ${superseding.id} but FAILED to link old memory ${oldId} ` +
        `— superseded_by was not set. Correction is INCOMPLETE: ${linkError?.message ?? "no row updated"}`
    );
  }

  console.log(
    `[memory] id=${superseding.id} memory_type=${superseding.memory_type} confirmation_status=${superseding.confirmation_status} action=supersede supersedes=${oldId}`
  );

  return { old: updatedOld as MemoryRecord, superseding };
}

// ── Revocation — tombstone, never a delete ────────────────────────────────────
//
// Sets revoked_at; the row, its claim, and every other column stay exactly
// as they were. Owner-scoped in the UPDATE's own WHERE clause (not a
// separate pre-check), so a mismatched owner_id updates zero rows at the SQL
// level — there is no code path where a cross-owner call has any effect.
export async function revokeMemory(id: string, owner_id: string): Promise<MemoryRecord> {
  if (!owner_id) throw new Error("revokeMemory requires owner_id");
  if (!id) throw new Error("revokeMemory requires id");

  const db = requireDb();
  const { data, error } = await db
    .from("memories")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", owner_id)
    .select(MEMORY_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`revokeMemory: no memory ${id} owned by this owner`);
  }

  const memory = data as MemoryRecord;
  console.log(
    `[memory] id=${memory.id} memory_type=${memory.memory_type} confirmation_status=${memory.confirmation_status} action=revoke`
  );
  return memory;
}

// ── Confirm / reject a candidate ──────────────────────────────────────────────
//
// Shared implementation: both confirmCandidate and rejectCandidate are valid
// ONLY on a row that isUnconfirmedCandidate() (see ./policy.ts) — an
// 'observed'/'owner_stated' row, or a candidate that's already been decided,
// is rejected. The eligibility check runs against a freshly fetched,
// owner-scoped row (so a mismatched owner_id is indistinguishable from "not
// found" and produces zero side effects), and only then is the UPDATE
// issued.
async function setConfirmationStatus(
  id: string,
  owner_id: string,
  status: "confirmed" | "rejected",
  action: "confirm" | "reject"
): Promise<MemoryRecord> {
  if (!owner_id) throw new Error(`${action}Candidate requires owner_id`);
  if (!id) throw new Error(`${action}Candidate requires id`);

  const db = requireDb();

  const current = await fetchOwnedMemory(db, id, owner_id);
  if (!current || !isUnconfirmedCandidate(current)) {
    throw new Error(
      `${action}Candidate: no unconfirmed inferred_candidate memory ${id} owned by this owner ` +
        "(wrong owner, wrong memory_type, or already confirmed/rejected)"
    );
  }

  const { data, error } = await db
    .from("memories")
    .update({ confirmation_status: status })
    .eq("id", id)
    .eq("owner_id", owner_id)
    .select(MEMORY_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`${action}Candidate: failed to update memory ${id}: ${error?.message ?? "no row updated"}`);
  }

  const memory = data as MemoryRecord;
  console.log(
    `[memory] id=${memory.id} memory_type=${memory.memory_type} confirmation_status=${memory.confirmation_status} action=${action}`
  );
  return memory;
}

export function confirmCandidate(id: string, owner_id: string): Promise<MemoryRecord> {
  return setConfirmationStatus(id, owner_id, "confirmed", "confirm");
}

export function rejectCandidate(id: string, owner_id: string): Promise<MemoryRecord> {
  return setConfirmationStatus(id, owner_id, "rejected", "reject");
}
