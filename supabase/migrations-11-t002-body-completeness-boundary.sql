-- Run this in Supabase SQL Editor after migrations-10-gmail-body-provenance.sql.
-- NOT applied to the live database as part of this change, and the boundary it
-- introduces is NOT activated by this file — activation is a separate,
-- deliberate, one-time operator action (see t002_activate_body_completeness_
-- boundary() below and docs/experiments/T-002.md "Deployment order").
--
-- This migration amends T-002's enrollment eligibility ONLY. It does not touch,
-- and must never be read as touching:
--   - the locked cap (15, set once in migrations-09, never altered here)
--   - T-002A thresholds, T-002B signal thresholds, the canary threshold
--   - the observation horizon (T002_OBSERVATION_HOURS)
--   - outcome definitions, lifecycle timestamp semantics
--   - t002_expire_overdue() — untouched
--
-- Why this is migration 11, not an edit to migration 9: t002_try_enroll() is
-- redefined below via CREATE OR REPLACE FUNCTION (same signature —
-- t002_try_enroll(UUID) RETURNS BOOLEAN — so no DROP FUNCTION is needed).
-- Migration 9's file is left completely untouched; it remains an accurate
-- historical record of the function as originally deployed. This migration is
-- the additive amendment layered on top, exactly how every other migration in
-- this repo evolves a previously-created object (see migrations-06/08's
-- CREATE OR REPLACE / DROP+CREATE pattern for search_document_pages).

-- ── 1. Boundary column on the existing singleton counter row ─────────────────
-- NULL means "not yet activated — enrollment paused." No DEFAULT: this column
-- must start NULL for the existing row (id = TRUE, already inserted by
-- migrations-09) exactly as it does for any fresh row this IF NOT EXISTS
-- creates — there is nothing to backfill or fabricate here.

ALTER TABLE t002_enrollment_counter
  ADD COLUMN IF NOT EXISTS body_completeness_boundary_at TIMESTAMPTZ;

-- ── 2. t002_try_enroll() amendment: refuse enrollment before activation, and ──
--       refuse any proposal created before the boundary once activated.
--
-- Eligibility rule: proposal_created_at >= body_completeness_boundary_at
-- (inclusive — a proposal created at exactly the recorded activation instant
-- is eligible). A proposal whose proposal_created_at cannot be determined is
-- treated the same as "before the boundary" — never eligible on missing data.
--
-- Concurrency: this function's FIRST statement is a `SELECT ... FOR UPDATE`
-- against the singleton counter row (id = TRUE) — the SAME row
-- t002_activate_body_completeness_boundary() locks with its own `FOR UPDATE`.
-- Postgres row locks serialize every caller (activation or enrollment) that
-- touches this row, so activation and a concurrent enrollment attempt can
-- never interleave: whichever transaction reaches the row first holds it
-- until it commits or rolls back, and the other blocks until then. This is
-- the same mechanism (a locked read/write on the singleton row) the cap check
-- already relied on before this amendment — extended to cover the boundary
-- read, not a new locking strategy.
CREATE OR REPLACE FUNCTION t002_try_enroll(p_proposal_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_rows INTEGER;
  v_boundary TIMESTAMPTZ;
  v_proposal_created_at TIMESTAMPTZ;
BEGIN
  -- Lock the singleton counter row up front (also serializes against
  -- activation) and read the current boundary under that lock.
  SELECT body_completeness_boundary_at INTO v_boundary
  FROM t002_enrollment_counter
  WHERE id = TRUE
  FOR UPDATE;

  IF v_boundary IS NULL THEN
    RETURN FALSE; -- enrollment paused: boundary not yet activated
  END IF;

  SELECT proposal_created_at INTO v_proposal_created_at
  FROM pending_proposals
  WHERE id = p_proposal_id;

  IF v_proposal_created_at IS NULL OR v_proposal_created_at < v_boundary THEN
    RETURN FALSE; -- created before the boundary, or unknown — never eligible
  END IF;

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
    -- Already enrolled (duplicate call for the same proposal) — release the
    -- slot we just reserved so it doesn't leak.
    UPDATE t002_enrollment_counter SET enrolled_count = enrolled_count - 1;
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION t002_try_enroll(UUID) TO service_role;

-- ── 3. One-time, narrowly-scoped activation function ──────────────────────────
--
-- Do not call this until AFTER the provenance-writing application code
-- (full-body Gmail retrieval, content_completeness/locally_truncated writes)
-- is deployed and verified in production. Calling it earlier lets proposals
-- created by old, pre-provenance application code enroll with legacy/unknown
-- source completeness the moment they're created on or after the boundary —
-- see docs/experiments/T-002.md "Deployment order" for the full corrected
-- sequence and the contamination defect this ordering avoids.
--
-- Refuses (via RAISE EXCEPTION — loud and unambiguous, appropriate for a
-- deliberate one-time operator action rather than a routine automated call)
-- if ANY of the following is true:
--   - enrolled_count is not 0
--   - any row already exists in t002_observations
--   - the boundary is already non-null
-- Never resets enrolled_count, never deletes observations, never alters cap,
-- never touches any threshold/hypothesis, never silently replaces an existing
-- boundary. On success, sets the boundary exactly once and returns it.
--
-- p_boundary_at is optional: pass an explicit timestamp to record a specific
-- deployment instant, or omit it to let the function stamp NOW() itself.
-- Either way, whatever gets stored becomes the fixed, immutable activation
-- instant used by every future t002_try_enroll() call — it is read once per
-- enrollment attempt from this column, never recomputed from a moving clock.
--
-- Usage (documented SQL, no new API endpoint — same "smallest production-safe
-- mechanism" precedent as the filter_rejections review workflow in
-- migrations-09):
--   SELECT t002_activate_body_completeness_boundary();               -- stamps NOW()
--   SELECT t002_activate_body_completeness_boundary('2026-08-05T12:00:00Z'); -- explicit instant
CREATE OR REPLACE FUNCTION t002_activate_body_completeness_boundary(
  p_boundary_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql AS $$
DECLARE
  v_enrolled_count INTEGER;
  v_existing_boundary TIMESTAMPTZ;
  v_observation_count INTEGER;
  v_boundary TIMESTAMPTZ;
BEGIN
  -- Lock the singleton row for the whole transaction — serializes against any
  -- concurrent t002_try_enroll() call (see that function's comment above).
  SELECT enrolled_count, body_completeness_boundary_at
  INTO v_enrolled_count, v_existing_boundary
  FROM t002_enrollment_counter
  WHERE id = TRUE
  FOR UPDATE;

  IF v_existing_boundary IS NOT NULL THEN
    RAISE EXCEPTION
      'T-002 body-completeness boundary is already set (%) — activation refused, never silently replaced',
      v_existing_boundary;
  END IF;

  IF v_enrolled_count <> 0 THEN
    RAISE EXCEPTION
      'T-002 enrolled_count is % (must be 0) — activation refused', v_enrolled_count;
  END IF;

  SELECT count(*) INTO v_observation_count FROM t002_observations;
  IF v_observation_count <> 0 THEN
    RAISE EXCEPTION
      'T-002 t002_observations already has % row(s) — activation refused', v_observation_count;
  END IF;

  v_boundary := COALESCE(p_boundary_at, NOW());

  UPDATE t002_enrollment_counter
  SET body_completeness_boundary_at = v_boundary
  WHERE id = TRUE;

  RETURN v_boundary;
END;
$$;

GRANT EXECUTE ON FUNCTION t002_activate_body_completeness_boundary(TIMESTAMPTZ) TO service_role;
