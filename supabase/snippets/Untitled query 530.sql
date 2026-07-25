CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          TEXT        PRIMARY KEY,
  count        INTEGER     NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS visitor_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id    TEXT        NOT NULL,
  gate_answer   TEXT,
  first_message TEXT        NOT NULL,
  action        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS visitor_log_session_idx ON visitor_log(session_id);
ALTER TABLE visitor_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS owner_actions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action     TEXT        NOT NULL,
  details    JSONB
);
ALTER TABLE owner_actions ENABLE ROW LEVEL SECURITY;