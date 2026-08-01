-- Run this in Supabase SQL Editor after migrations-08-fts-fallback.sql.
--
-- T-002 (routed-item responsiveness baseline) instrumentation. Adds:
--   1. A retroactive CREATE TABLE for pending_proposals — this table was created
--      directly against the live project and never had a committed migration.
--      This statement is a documented no-op against prod (table already exists
--      with this exact shape — verified against the live schema before writing
--      this file) and brings the repo back in sync with reality.
--   2. Lifecycle timestamp + outcome columns on pending_proposals (additive only —
--      no existing column is renamed or dropped).
--   3. filter_rejections — forward-only audit log of relevance-filter drops.
--   4. proposal_events — append-only lifecycle event log.
--   5. t002_enrollment_counter / t002_observations / t002_try_enroll() — the
--      atomic, capped enrollment mechanism for the T-002 population.
--
-- All new tables get RLS enabled with no policies, matching every other table in
-- this schema — access is exclusively via the service-role key server-side.

-- ── 1. Retroactive pending_proposals (documents live drift; no-op against prod) ──

CREATE TABLE IF NOT EXISTS pending_proposals (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id      TEXT        NOT NULL UNIQUE,
  sender                TEXT        NOT NULL DEFAULT '',
  subject               TEXT        NOT NULL DEFAULT '',
  classification        TEXT        NOT NULL DEFAULT 'actionable',
  reason                TEXT        NOT NULL DEFAULT '',
  draft_body            TEXT,
  grounded_sources      JSONB       NOT NULL DEFAULT '[]',
  suggested_attachments JSONB       NOT NULL DEFAULT '[]',
  thread_id             TEXT,
  in_reply_to_id        TEXT,
  status                TEXT        NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_proposals_status_check CHECK (status IN ('pending', 'sent', 'skipped'))
);
CREATE INDEX IF NOT EXISTS pending_proposals_status_idx ON pending_proposals(status);
CREATE INDEX IF NOT EXISTS pending_proposals_created_at_idx ON pending_proposals(created_at DESC);
ALTER TABLE pending_proposals ENABLE ROW LEVEL SECURITY;

-- ── 2. Lifecycle timestamps + normalized outcome ─────────────────────────────────

ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS source_received_at        TIMESTAMPTZ;
-- True when source_received_at fell back to processing time because the Gmail
-- Date header was missing (see lib/relevance/channels/gmail.ts). NULL for
-- pre-existing/backfilled rows, where we don't know either way. Rows with this
-- TRUE must be excluded from "total system latency" (see lib/t002.ts
-- totalSystemLatencyPairs) — they don't measure true source-to-decision latency.
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS source_received_at_inferred BOOLEAN;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS detected_at               TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS filtered_at               TIMESTAMPTZ;
-- No DEFAULT here deliberately: ADD COLUMN ... DEFAULT NOW() would immediately
-- stamp every *existing* row with the migration's run time, which is exactly the
-- fabrication this migration's own backfill step exists to avoid. New rows set
-- this explicitly at insert time (lib/inbox-watch.ts), same as detected_at/filtered_at.
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS proposal_created_at       TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS notification_attempted_at TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS notification_accepted_at  TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS first_viewed_at           TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS decision_at               TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS sent_at                   TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS skipped_at                TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS expired_at                TIMESTAMPTZ;
ALTER TABLE pending_proposals ADD COLUMN IF NOT EXISTS outcome                   TEXT;

-- Widen the status CHECK to admit the two new terminal states this feature
-- introduces. Existing values (pending/sent/skipped) remain valid — nothing that
-- already satisfied this constraint stops satisfying it.
ALTER TABLE pending_proposals DROP CONSTRAINT IF EXISTS pending_proposals_status_check;
ALTER TABLE pending_proposals ADD CONSTRAINT pending_proposals_status_check
  CHECK (status IN ('pending', 'sent', 'skipped', 'expired', 'failed'));

ALTER TABLE pending_proposals DROP CONSTRAINT IF EXISTS pending_proposals_outcome_check;
ALTER TABLE pending_proposals ADD CONSTRAINT pending_proposals_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('pending', 'sent', 'skipped', 'expired', 'failed'));

-- Conservative backfill for existing rows only — never fabricates a timestamp that
-- wasn't already captured. proposal_created_at maps from the existing created_at;
-- outcome maps from the existing status; every other lifecycle timestamp stays
-- NULL because no earlier real value exists to backfill it from.
UPDATE pending_proposals
SET proposal_created_at = COALESCE(proposal_created_at, created_at),
    outcome = COALESCE(outcome, CASE status
                WHEN 'sent'    THEN 'sent'
                WHEN 'skipped' THEN 'skipped'
                ELSE 'pending'
              END)
WHERE proposal_created_at IS NULL OR outcome IS NULL;

CREATE INDEX IF NOT EXISTS pending_proposals_outcome_idx ON pending_proposals(outcome);

-- ── 3. filter_rejections — forward-only, minimal-PII audit of relevance-filter drops ──

CREATE TABLE IF NOT EXISTS filter_rejections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id  TEXT        NOT NULL,
  source_domain     TEXT        NOT NULL DEFAULT '',
  source_identifier TEXT        NOT NULL DEFAULT '',
  rejected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_outcome    TEXT        NOT NULL DEFAULT 'unreviewed',
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT filter_rejections_review_outcome_check
    CHECK (review_outcome IN ('unreviewed', 'time_sensitive', 'not_time_sensitive'))
);
-- One row per rejected message — a still-unread message that gets re-fetched and
-- re-dropped on a later run must not spam duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS filter_rejections_gmail_message_id_key
  ON filter_rejections(gmail_message_id);
CREATE INDEX IF NOT EXISTS filter_rejections_review_outcome_idx ON filter_rejections(review_outcome);
CREATE INDEX IF NOT EXISTS filter_rejections_rejected_at_idx ON filter_rejections(rejected_at DESC);
ALTER TABLE filter_rejections ENABLE ROW LEVEL SECURITY;

-- Documented SQL for the manual review workflow (deliberately no new UI/endpoint —
-- smallest production-safe mechanism per spec):
--
--   -- List unreviewed rejections:
--   SELECT id, source_domain, source_identifier, rejected_at
--   FROM filter_rejections
--   WHERE review_outcome = 'unreviewed'
--   ORDER BY rejected_at DESC
--   LIMIT 50;
--
--   -- Mark one reviewed (run once per row, after manually checking Gmail by sender):
--   UPDATE filter_rejections
--   SET review_outcome = 'time_sensitive', reviewed_at = NOW()  -- or 'not_time_sensitive'
--   WHERE id = '<uuid>' AND review_outcome = 'unreviewed';

-- ── 4. proposal_events — append-only lifecycle log ───────────────────────────────

CREATE TABLE IF NOT EXISTS proposal_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID        NOT NULL REFERENCES pending_proposals(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT proposal_events_event_type_check CHECK (event_type IN (
    'detected', 'passed_filter', 'proposal_created', 'notification_attempted',
    'notification_accepted', 'viewed', 'sent', 'skipped', 'expired', 'failed'
  ))
);
CREATE INDEX IF NOT EXISTS proposal_events_proposal_id_idx ON proposal_events(proposal_id);
CREATE INDEX IF NOT EXISTS proposal_events_event_type_idx ON proposal_events(event_type);
ALTER TABLE proposal_events ENABLE ROW LEVEL SECURITY;

-- ── 5. Atomic, capped T-002 enrollment ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS t002_enrollment_counter (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- singleton row
  cap            INTEGER NOT NULL,
  enrolled_count INTEGER NOT NULL DEFAULT 0 CHECK (enrolled_count >= 0)
);
ALTER TABLE t002_enrollment_counter ENABLE ROW LEVEL SECURITY;

-- Locked cap. See docs/experiments/T-002.md "Historical arrival-rate result" —
-- a 13-week retrospective review found a median of 0 eligible proposals/week, too
-- sparse to reliably project a weeks-to-cap estimate for any cap size. 15 (the
-- smallest offered option) was locked on that basis. Do not change this value
-- after the first T-002 proposal enrolls.
INSERT INTO t002_enrollment_counter (id, cap, enrolled_count)
VALUES (TRUE, 15, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS t002_observations (
  proposal_id UUID        PRIMARY KEY REFERENCES pending_proposals(id),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE t002_observations ENABLE ROW LEVEL SECURITY;

-- Atomically attempts to enroll one proposal into the T-002 population.
-- Returns true if enrolled, false if the cap was already reached or the proposal
-- was already enrolled. Safe under concurrent calls: the UPDATE on the singleton
-- counter row takes a row lock for the remainder of the caller's transaction,
-- serializing every concurrent enrollment attempt against the same cap check.
CREATE OR REPLACE FUNCTION t002_try_enroll(p_proposal_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE t002_enrollment_counter
  SET enrolled_count = enrolled_count + 1
  WHERE enrolled_count < cap;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN FALSE; -- cap already reached
  END IF;

  INSERT INTO t002_observations (proposal_id)
  VALUES (p_proposal_id)
  ON CONFLICT (proposal_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    -- Already enrolled (duplicate call for the same proposal) — release the slot
    -- we just reserved so it doesn't leak.
    UPDATE t002_enrollment_counter SET enrolled_count = enrolled_count - 1;
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION t002_try_enroll(UUID) TO service_role;

-- Server-side, deterministic, idempotent expiration for the T-002 population only
-- (non-enrolled proposals are unaffected — this function only ever touches rows
-- that have a matching t002_observations row). Never overwrites sent/skipped
-- (WHERE status = 'pending'), records expiration exactly once
-- (WHERE expired_at IS NULL), and takes the observation-horizon length as a
-- parameter so the caller supplies T002_OBSERVATION_HOURS rather than the
-- function hardcoding it. Returns the ids it expired so the caller can log
-- 'expired' proposal_events for each.
CREATE OR REPLACE FUNCTION t002_expire_overdue(p_hours INTEGER)
RETURNS TABLE(proposal_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE pending_proposals p
  SET status = 'expired',
      outcome = 'expired',
      expired_at = NOW()
  FROM t002_observations o
  WHERE o.proposal_id = p.id
    AND p.status = 'pending'
    AND p.expired_at IS NULL
    AND o.enrolled_at + make_interval(hours => p_hours) < NOW()
  RETURNING p.id;
END;
$$;

GRANT EXECUTE ON FUNCTION t002_expire_overdue(INTEGER) TO service_role;
