-- Run this in Supabase SQL Editor after migrations-09-t002-instrumentation.sql.
-- NOT applied to the live database as part of this change — see the branch's
-- final report for why (out of scope for this pass).
--
-- Adds Gmail full-body retrieval provenance columns to pending_proposals —
-- purely additive. Does not touch any existing column, constraint, status,
-- outcome, timestamp, enrollment mechanism, or proposal content. Does not
-- touch T-002 tables/functions at all.
--
-- No backfill. Every column below stays NULL for every row that already
-- exists at the time this runs — legacy/unknown, never fabricated. There is
-- no DEFAULT on any of these columns for exactly that reason: a DEFAULT would
-- retroactively stamp existing rows the moment the column is added (this is
-- the same mistake caught and corrected for proposal_created_at in
-- migrations-09 — see that file's comment). New rows only ever get real
-- values because lib/inbox-watch.ts writes them explicitly from the
-- MessageBodyResult that actually produced that proposal's email_text
-- (see lib/gmail.ts provenanceToInsertFields).
--
-- content_completeness / locally_truncated are stored as independent columns
-- on purpose — never combine them into values like "full_truncated". Metric
-- and query code must be able to ask for each independently (e.g. "all
-- partial proposals" and "all locally truncated proposals" are different,
-- overlapping questions).

ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS content_completeness TEXT;

ALTER TABLE pending_proposals DROP CONSTRAINT IF EXISTS pending_proposals_content_completeness_check;
ALTER TABLE pending_proposals ADD CONSTRAINT pending_proposals_content_completeness_check
  CHECK (content_completeness IS NULL OR content_completeness IN ('full', 'partial', 'snippet_only', 'fetch_failed'));

ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS locally_truncated BOOLEAN;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS body_parts_failed INTEGER;

ALTER TABLE pending_proposals DROP CONSTRAINT IF EXISTS pending_proposals_body_parts_failed_check;
ALTER TABLE pending_proposals ADD CONSTRAINT pending_proposals_body_parts_failed_check
  CHECK (body_parts_failed IS NULL OR body_parts_failed >= 0);

ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS body_original_character_count INTEGER;

ALTER TABLE pending_proposals DROP CONSTRAINT IF EXISTS pending_proposals_body_original_character_count_check;
ALTER TABLE pending_proposals ADD CONSTRAINT pending_proposals_body_original_character_count_check
  CHECK (body_original_character_count IS NULL OR body_original_character_count >= 0);

-- Fixed-vocabulary safe error codes only (matches lib/gmail.ts's
-- PROPOSAL-adjacent codes exactly — see that file). Never free text: no
-- email body, snippet, subject, raw provider response, token, or attachment
-- content can be stored here even by application-code mistake, because the
-- CHECK constraint below rejects anything outside this fixed set.
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS body_error_codes TEXT[];

ALTER TABLE pending_proposals DROP CONSTRAINT IF EXISTS pending_proposals_body_error_codes_check;
ALTER TABLE pending_proposals ADD CONSTRAINT pending_proposals_body_error_codes_check
  CHECK (
    body_error_codes IS NULL OR body_error_codes <@ ARRAY[
      'GMAIL_FETCH_FAILED',
      'GMAIL_BODY_EMPTY',
      'GMAIL_MIME_PARSE_FAILED',
      'GMAIL_BODY_PART_FETCH_FAILED',
      'GMAIL_BODY_SNIPPET_FALLBACK',
      'GMAIL_BODY_LOCALLY_TRUNCATED',
      'GMAIL_BASE64_DECODE_FAILED'
    ]::text[]
  );

CREATE INDEX IF NOT EXISTS pending_proposals_content_completeness_idx
  ON pending_proposals(content_completeness);
