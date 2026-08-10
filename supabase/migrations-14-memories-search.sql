-- Run this in Supabase SQL Editor after migrations-13-memories.sql.
--
-- READ PATH — prompt 4 of 4 for Tacit's memory store (1: schema →
-- 2: write path → 3: correction/revocation → 4: read path [this file +
-- lib/memory/retrieve.ts]). Adds full-text search over memories.claim,
-- mirroring document_pages' fts column/index and search_document_pages_all's
-- current query-construction/scoring approach — websearch_to_tsquery primary
-- match + OR-lexeme fallback for forgiving multi-word queries, see
-- migrations-08-fts-fallback.sql — rather than inventing a new retrieval
-- style for this corpus.
--
-- THE EXCLUSION FILTER IS BAKED INTO THIS FUNCTION'S WHERE CLAUSE, not left
-- to the caller. A superseded, revoked, unconfirmed, cross-owner, or stale
-- memory can never be fetched through search_memories() — not "filtered out
-- after the fact" by whatever TypeScript happens to call it, but structurally
-- absent from the result set of the query itself, including if this function
-- is ever called directly from SQL/psql. This is the single most important
-- property of this migration: prompt 3 built supersedeMemory/revokeMemory/
-- confirm/reject specifically so a corrected-away or never-confirmed claim
-- could stop being true; this WHERE clause is where that correction actually
-- takes effect for the first time.
--
--   superseded_by IS NULL                              -- not corrected away
--   revoked_at IS NULL                                  -- not revoked
--   confirmation_status = 'confirmed'                   -- not a candidate, not rejected
--   owner_id = p_owner_id                                -- never cross-owner
--   p_include_stale OR valid_until IS NULL OR valid_until >= now()  -- not stale
--
-- p_include_stale exists ONLY as a SQL-level debugging escape hatch (e.g. run
-- directly in the SQL editor to see what a memory looked like before it went
-- stale) and defaults to false. lib/memory/retrieve.ts's searchMemories()
-- never exposes it to callers and always passes false explicitly — there is
-- no application code path that can set it true.

ALTER TABLE memories ADD COLUMN IF NOT EXISTS fts tsvector GENERATED ALWAYS AS (to_tsvector('english', claim)) STORED;

CREATE INDEX IF NOT EXISTS memories_fts_idx ON memories USING GIN (fts);

CREATE OR REPLACE FUNCTION search_memories(
  q               text,
  p_owner_id      text,
  lim             int DEFAULT 8,
  p_include_stale boolean DEFAULT false
)
RETURNS TABLE (
  id             uuid,
  claim          text,
  memory_type    text,
  source_kind    text,
  source_id      text,
  source_locator jsonb,
  confidence     numeric,
  score          real
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  ts_q        tsquery;
  ts_fallback tsquery;
  lex_str     text;
BEGIN
  -- Primary: phrase match using websearch syntax (AND semantics, supports "-").
  ts_q := websearch_to_tsquery('english', q);

  -- Fallback: OR of individual lexemes so partial matches still surface.
  -- to_tsvector on the query string applies the same dictionary as the index.
  SELECT string_agg(lexeme, ' | ')
  INTO   lex_str
  FROM   unnest(to_tsvector('english', q))
  WHERE  lexeme IS NOT NULL;

  IF lex_str IS NOT NULL THEN
    ts_fallback := to_tsquery('english', lex_str);
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.claim, m.memory_type, m.source_kind, m.source_id, m.source_locator, m.confidence,
    CASE
      WHEN m.fts @@ ts_q           THEN ts_rank(m.fts, ts_q)::real
      WHEN ts_fallback IS NOT NULL THEN (ts_rank(m.fts, ts_fallback) * 0.7)::real
      ELSE 0::real
    END AS score
  FROM memories m
  WHERE m.owner_id = p_owner_id
    AND m.superseded_by IS NULL
    AND m.revoked_at IS NULL
    AND m.confirmation_status = 'confirmed'
    AND (p_include_stale OR m.valid_until IS NULL OR m.valid_until >= now())
    AND (m.fts @@ ts_q OR (ts_fallback IS NOT NULL AND m.fts @@ ts_fallback))
  ORDER BY score DESC
  LIMIT lim;
END;
$$;

GRANT EXECUTE ON FUNCTION search_memories(text, text, int, boolean) TO service_role;
