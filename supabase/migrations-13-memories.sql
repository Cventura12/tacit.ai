-- Run this in Supabase SQL Editor after migrations-12-pending-proposals-reply-required.sql.
--
-- SCHEMA ONLY — prompt 1 of a 4-part build for Tacit's write-back memory
-- store (1: schema [this file] → 2: write path → 3: correction/revocation →
-- 4: read path). This migration creates the `memories` table and nothing
-- else. No application code reads or writes it yet — the table is inert
-- until prompts 2-4 land. See lib/db.ts for the matching typed
-- Row/Insert/Update shapes.
--
-- DESIGN: a memory is a CLAIM plus a POINTER to the evidence it came from —
-- never a bare, sourceless assertion. source_kind + source_id +
-- source_locator together say exactly where a claim was extracted from (a
-- document page, a Gmail message, a conversation turn), so every row stays
-- traceable back to its evidence. Append-only from the first row:
-- corrections and retractions happen via superseded_by and revoked_at
-- (prompt 3), never via UPDATE-in-place or DELETE — history is preserved.

CREATE TABLE IF NOT EXISTS memories (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Every row carries it; every future query filters on it. Multi-tenant
  -- from line one even though there is currently exactly one owner
  -- (OWNER_CLERK_USER_ID — see lib/auth.ts).
  owner_id            TEXT        NOT NULL,
  -- The extracted assertion, in plain language — e.g. "lease ends May 1,
  -- 2026" — never the raw source text itself; that lives at source_kind/
  -- source_id/source_locator, one level removed.
  claim               TEXT        NOT NULL,
  -- 'observed'            — extracted verbatim/near-verbatim from a source
  -- 'owner_stated'        — the owner told Tacit this directly
  -- 'inferred_candidate'  — derived/inferred, not yet confirmed
  memory_type         TEXT        NOT NULL
    CHECK (memory_type IN ('observed', 'owner_stated', 'inferred_candidate')),
  -- What kind of evidence this claim points back to.
  source_kind         TEXT        NOT NULL
    CHECK (source_kind IN ('document', 'email', 'conversation')),
  -- The evidence's own identifier within its kind: documents.id, a Gmail
  -- message id, or a conversation/agent-run id. Opaque outside its
  -- source_kind — never assume cross-kind uniqueness.
  source_id           TEXT        NOT NULL,
  -- Nullable: finer-grained pointer within the source — page + character
  -- span for a document, message metadata for an email, turn index for a
  -- conversation. Shape depends on source_kind; not constrained here since
  -- the write path (prompt 2) owns that contract.
  source_locator      JSONB,
  -- Nullable: extraction confidence, when the extractor produces one.
  confidence          NUMERIC,
  confirmation_status TEXT        NOT NULL DEFAULT 'unconfirmed'
    CHECK (confirmation_status IN ('confirmed', 'unconfirmed', 'rejected')),
  -- Nullable: an EVIDENCE-derived expiry (e.g. a document states a permit
  -- expires on a specific date) — NOT a cache TTL. Absence means the claim
  -- has no known expiry, not that it expires "never."
  valid_until         TIMESTAMPTZ,
  -- Nullable: points to the memory row that supersedes this one, once a
  -- correction lands (prompt 3). Self-referential — this is how a row
  -- records its own history of being superseded, never a rewrite of claim
  -- in place.
  superseded_by       UUID        REFERENCES memories(id),
  -- Nullable: revocation tombstone. A revoked row is never deleted — its
  -- claim stays on record, just marked no-longer-valid as of this timestamp.
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memories_owner_id_idx ON memories(owner_id);
CREATE INDEX IF NOT EXISTS memories_owner_id_memory_type_idx ON memories(owner_id, memory_type);

-- RLS: the server currently talks to Supabase exclusively via the
-- service-role key (lib/db.ts's getDb()), which bypasses RLS entirely — so
-- this policy has zero effect on today's behavior. It is added now, at
-- table creation, as defense-in-depth for the day a non-service-role client
-- (anon/authenticated key) ever touches this table, so owner-scoping isn't
-- retrofitted later onto rows that were never designed with it in mind.
-- owner_id is expected to match the JWT 'sub' claim of whatever future
-- non-service-role auth path reaches this table.
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY memories_owner_scoped ON memories
  USING (owner_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'))
  WITH CHECK (owner_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

-- RLS bypass (service_role has BYPASSRLS) is a separate permission layer from
-- baseline table privileges — service_role still needs an explicit GRANT to
-- touch this table at all, matching every other RLS-enabled table in this
-- schema (see documents/document_pages/agent_runs/tool_runs/retrieval_traces).
GRANT ALL ON memories TO service_role;
