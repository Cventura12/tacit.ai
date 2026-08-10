// Pure write-policy logic for Tacit's memory store — no I/O, no imports.
// Kept dependency-free (no @/-aliased imports) specifically so it can be
// exercised directly by Node's native test runner without a build step —
// same convention as lib/tools/tool-log-summary.ts and
// lib/tools/owner/handle_email_grounding.ts. See lib/memory/store.test.ts.
// lib/memory/store.ts imports this module and adds the actual database
// write on top; nothing here performs I/O.
//
// DESIGN: a memory is a CLAIM plus a POINTER to the evidence it came from —
// never a bare, sourceless assertion (see supabase/migrations-13-memories.sql).
// "Never conclude" is the write policy: retrieve-and-cite is trusted and
// auto-writes confirmed; a model's own guess is held as an unconfirmed
// candidate, never written as settled fact.

export const MEMORY_TYPES = ["observed", "owner_stated", "inferred_candidate"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const SOURCE_KINDS = ["document", "email", "conversation"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type ConfirmationStatus = "confirmed" | "unconfirmed" | "rejected";

// memory_type -> the ONLY confirmation_status a write of that type may ever
// persist with. Looked up here, never accepted from the caller: an
// 'observed' write can never land 'unconfirmed', and an 'inferred_candidate'
// can never land 'confirmed'.
export const CONFIRMATION_STATUS_BY_MEMORY_TYPE: Record<MemoryType, ConfirmationStatus> = {
  observed: "confirmed",
  owner_stated: "confirmed",
  inferred_candidate: "unconfirmed",
};

export interface WriteMemoryInput {
  owner_id: string;
  claim: string;
  memory_type: MemoryType;
  source_kind: SourceKind;
  source_id: string;
  source_locator?: unknown;
  confidence?: number | null;
  valid_until?: string | null;
}

// Mirrors the memories table's Insert shape (see lib/db.ts) without
// importing it — this file stays free of @/-aliased imports on purpose.
export interface MemoryInsertRow {
  owner_id: string;
  claim: string;
  memory_type: MemoryType;
  source_kind: SourceKind;
  source_id: string;
  source_locator: unknown;
  confidence: number | null;
  confirmation_status: ConfirmationStatus;
  valid_until: string | null;
}

// Validates input and derives the exact row to insert, including
// confirmation_status. Throws on any invalid input; never returns a
// partially-valid row. This function IS the write policy: every rule below
// is enforced here, in code — never merely trusted from the caller.
export function buildMemoryInsertRow(input: WriteMemoryInput): MemoryInsertRow {
  if (!input.owner_id) {
    throw new Error("writeMemory requires owner_id — no default, no fallback owner");
  }
  if (!input.claim || !input.claim.trim()) {
    throw new Error("writeMemory requires a non-empty claim");
  }
  if (!MEMORY_TYPES.includes(input.memory_type)) {
    throw new Error(`writeMemory: invalid memory_type "${input.memory_type}"`);
  }
  // No sourceless memories — for EVERY memory_type, including
  // inferred_candidate. A model's guess still points at whatever triggered
  // it; there is no code path that writes a memory without a source pointer.
  if (!input.source_kind || !input.source_id) {
    throw new Error(
      `writeMemory requires source_kind and source_id (memory_type=${input.memory_type}) — ` +
        "no memory may be written without a source pointer"
    );
  }
  if (!SOURCE_KINDS.includes(input.source_kind)) {
    throw new Error(`writeMemory: invalid source_kind "${input.source_kind}"`);
  }

  return {
    owner_id: input.owner_id,
    claim: input.claim,
    memory_type: input.memory_type,
    source_kind: input.source_kind,
    source_id: input.source_id,
    source_locator: input.source_locator ?? null,
    confidence: input.confidence ?? null,
    // Derived from memory_type only — see CONFIRMATION_STATUS_BY_MEMORY_TYPE
    // above. Nothing on WriteMemoryInput can influence this value; the type
    // doesn't even declare a confirmation_status field, so there is nothing
    // for a caller to force.
    confirmation_status: CONFIRMATION_STATUS_BY_MEMORY_TYPE[input.memory_type],
    valid_until: input.valid_until ?? null,
  };
}

// ── Confirm/reject eligibility ────────────────────────────────────────────────
// The one rule confirmCandidate/rejectCandidate share, expressed once so both
// callers (lib/memory/store.ts) can't drift apart: a row is only ever
// confirmable/rejectable while it is an untouched inferred_candidate. An
// 'observed' or 'owner_stated' row was never a guess, so there is nothing to
// confirm; a candidate that's already 'confirmed' or 'rejected' has already
// had its one decision made — correcting THAT is what supersedeMemory is for,
// not a second confirm/reject.
export function isUnconfirmedCandidate(row: {
  memory_type: string;
  confirmation_status: string;
}): boolean {
  return row.memory_type === "inferred_candidate" && row.confirmation_status === "unconfirmed";
}

// ── Read-path parameter building ──────────────────────────────────────────────
// Used by lib/memory/retrieve.ts's searchMemories(). The actual exclusion
// filter (superseded/revoked/unconfirmed/cross-owner/stale) is NOT here —
// it's baked into search_memories()'s own WHERE clause in
// supabase/migrations-14-memories-search.sql, deliberately not duplicated in
// TypeScript, so there is exactly one place that guarantee lives. What IS
// enforced here is input validity and the fixed p_include_stale=false — the
// one knob this layer refuses to expose to any caller.

const DEFAULT_SEARCH_LIMIT = 8;

export interface SearchMemoriesParams {
  q: string;
  p_owner_id: string;
  lim: number;
  // Always false. p_include_stale exists on search_memories() purely as a
  // SQL-level debugging escape hatch — this TypeScript layer never exposes a
  // way to set it true, so every call built here excludes stale memories.
  p_include_stale: false;
}

// Validates input and derives the exact RPC parameters for search_memories().
// Throws on invalid input; never returns partially-valid params. Pure — no
// I/O — the read-path counterpart to buildMemoryInsertRow above.
export function buildSearchMemoriesParams(
  owner_id: string,
  query: string,
  limit?: number
): SearchMemoriesParams {
  if (!owner_id) {
    throw new Error("searchMemories requires owner_id — no default, no fallback owner");
  }
  if (!query || !query.trim()) {
    throw new Error("searchMemories requires a non-empty query");
  }
  return {
    q: query,
    p_owner_id: owner_id,
    lim: limit ?? DEFAULT_SEARCH_LIMIT,
    p_include_stale: false,
  };
}

// ── Owner-stated write-back (prompt 5) ────────────────────────────────────────
// Pure planning logic for lib/memory/extract.ts's extractOwnerStatedMemories.
// The LLM extraction call and the dedup lookup (both I/O) live in extract.ts;
// everything about what to DO with their results — build the write-memory
// input, decide what's a duplicate — lives here, unit-testable without a
// database or a model call.

// Lowercased + whitespace-collapsed + trimmed. Exact-normalized dedup only —
// "confirmed for March 3rd" and "confirmed attendance on 3/3" are NOT caught
// as duplicates by this. Catching semantically-equivalent rewordings would
// need an LLM or embedding comparison; deliberately not added here — see
// isDuplicateClaim below.
export function normalizeClaim(claim: string): string {
  return claim.toLowerCase().trim().replace(/\s+/g, " ");
}

// A candidate claim is a duplicate of an existing one only if their
// normalized forms are IDENTICAL. Known v1 limitation, stated plainly: a
// semantically-identical claim phrased differently will NOT be caught here
// and will be written as a second row. Closing that gap is a later pass.
export function isDuplicateClaim(candidateClaim: string, existingClaims: string[]): boolean {
  const normalized = normalizeClaim(candidateClaim);
  return existingClaims.some((c) => normalizeClaim(c) === normalized);
}

export interface OwnerStatedSource {
  ownerId: string;
  // The SENT reply's own Gmail message id — never the original inbound
  // message's id. This is what makes the memory attributable to an action
  // the owner actually took (approving/editing and sending THIS reply),
  // not merely to having received an email.
  sourceGmailMessageId: string;
  threadId?: string;
  inReplyToId?: string;
}

// Builds the exact writeMemory() input for one extracted claim. memory_type
// is hardcoded 'owner_stated' — this function has no other caller and no
// other memory_type this task is scoped to produce (no 'observed', no
// 'inferred_candidate' — see lib/memory/extract.ts's module header).
// confirmation_status is NOT set here; buildMemoryInsertRow (above) derives
// it from memory_type exactly as it does for every other write path.
export function buildOwnerStatedWriteInput(claim: string, source: OwnerStatedSource): WriteMemoryInput {
  if (!claim || !claim.trim()) {
    throw new Error("buildOwnerStatedWriteInput requires a non-empty claim");
  }
  if (!source.ownerId) {
    throw new Error("buildOwnerStatedWriteInput requires ownerId");
  }
  if (!source.sourceGmailMessageId) {
    throw new Error("buildOwnerStatedWriteInput requires sourceGmailMessageId");
  }
  return {
    owner_id: source.ownerId,
    claim,
    memory_type: "owner_stated",
    source_kind: "email",
    source_id: source.sourceGmailMessageId,
    source_locator: {
      thread_id: source.threadId ?? null,
      in_reply_to_id: source.inReplyToId ?? null,
    },
  };
}

export interface OwnerStatedWritePlan {
  toWrite: WriteMemoryInput[];
  skippedAsDuplicate: number;
}

// Pure planning step: given the claims an LLM extracted from a sent reply
// and the owner's existing confirmed claim texts (already fetched by the
// caller — this function performs no I/O of its own), decides exactly which
// writeMemory() calls to make. An empty `claims` list always yields an empty
// plan — extraction finding nothing is the common, expected case (most
// replies commit to nothing new), not a failure.
export function planOwnerStatedWrites(
  claims: string[],
  existingClaims: string[],
  source: OwnerStatedSource
): OwnerStatedWritePlan {
  const toWrite: WriteMemoryInput[] = [];
  let skippedAsDuplicate = 0;
  for (const claim of claims) {
    if (isDuplicateClaim(claim, existingClaims)) {
      skippedAsDuplicate++;
      continue;
    }
    toWrite.push(buildOwnerStatedWriteInput(claim, source));
  }
  return { toWrite, skippedAsDuplicate };
}
