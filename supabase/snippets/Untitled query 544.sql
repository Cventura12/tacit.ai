-- ─── agent_runs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_runs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  user_query   text        NOT NULL,
  response_text text       NOT NULL,
  duration_ms  int         NOT NULL,
  tool_count   int         NOT NULL DEFAULT 0,
  error        text
);

CREATE INDEX IF NOT EXISTS agent_runs_created_at_idx ON agent_runs (created_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON agent_runs TO service_role;

-- ─── tool_runs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tool_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  tool_name      text        NOT NULL,
  input          jsonb       NOT NULL,
  output_summary text        NOT NULL,
  duration_ms    int         NOT NULL,
  success        boolean     NOT NULL,
  error          text,
  sequence       int         NOT NULL
);

CREATE INDEX IF NOT EXISTS tool_runs_run_id_idx ON tool_runs (run_id);

ALTER TABLE tool_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON tool_runs TO service_role;

-- ─── retrieval_traces ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS retrieval_traces (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_run_id  uuid    NOT NULL REFERENCES tool_runs(id) ON DELETE CASCADE,
  doc_id       uuid    NOT NULL,
  doc_title    text    NOT NULL,
  page_number  int     NOT NULL,
  score        real    NOT NULL,
  returned     boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS retrieval_traces_tool_run_id_idx ON retrieval_traces (tool_run_id);

ALTER TABLE retrieval_traces ENABLE ROW LEVEL SECURITY;
GRANT ALL ON retrieval_traces TO service_role;
