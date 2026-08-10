// Read path for Tacit's memory store — prompt 4 of 4 (1: schema → 2: write
// path → 3: correction/revocation → 4: read path [this file]). This is the
// FIRST prompt that makes a memory affect anything Tacit does: nothing
// before this file ever influenced a draft, a grounding block, or a tool
// result, no matter how many memories existed in the table.
//
// Mirrors lib/documents.ts's search() in shape and approach: a full-text RPC
// call, ranked, capped at a limit, returning hits the caller can cite by
// their source — not a hand-rolled retrieval style for this corpus. See
// supabase/migrations-14-memories-search.sql for the search_memories()
// function and its GIN-indexed fts column over claim text.
//
// THE EXCLUSION FILTER (superseded / revoked / unconfirmed / cross-owner /
// stale) is enforced entirely inside that SQL function's WHERE clause, not
// here. This file trusts it completely and adds no redundant
// post-processing filter — there is exactly one place that guarantee lives,
// and this file cannot drift from it.
//
// DESIGN: memory retrieval is document retrieval pointed at a new corpus — a
// memory is retrieved BY RELEVANCE TO THE CURRENT TASK and returned WITH ITS
// SOURCE, never a blanket "everything the owner is known to believe" dump.
// Injecting all memories into every task would reintroduce, as a LEARNED
// bias, exactly what the earlier retrieval de-bias work removed as a
// HARDCODED one.

import { getDb, isDbConfigured } from "@/lib/db";
import { buildSearchMemoriesParams, type MemoryType, type SourceKind } from "./policy";

export interface MemoryHit {
  id: string;
  claim: string;
  memory_type: MemoryType;
  source_kind: SourceKind;
  source_id: string;
  source_locator: unknown;
  confidence: number | null;
  score: number;
}

function requireDb() {
  if (!isDbConfigured()) throw new Error("Database is not configured");
  return getDb();
}

// Returns memories relevant to `query`, scoped to `owner_id`, ranked by
// full-text score and capped at `limit` (default 8, matching
// lib/documents.ts's search() default). Each hit carries its claim AND its
// source pointer (source_kind, source_id, source_locator) so the caller can
// cite it exactly as document retrieval is already cited in
// handle_email/cross_reference.
export async function searchMemories(
  owner_id: string,
  query: string,
  limit?: number
): Promise<MemoryHit[]> {
  const params = buildSearchMemoriesParams(owner_id, query, limit);

  const db = requireDb();
  const { data, error } = await db.rpc("search_memories", params);

  if (error) {
    throw new Error(`Memory search failed: ${error.message}`);
  }

  const hits = (data ?? []) as MemoryHit[];

  // Count and query LENGTH only — never claim text, source content, or the
  // query string itself, which may carry email-derived content.
  console.log(`[memory] search hits=${hits.length} query_length=${query.length} limit=${params.lim}`);

  return hits;
}
