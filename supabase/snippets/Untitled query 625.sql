CREATE TABLE IF NOT EXISTS connectors (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 TEXT        NOT NULL CHECK (type IN ('builtin', 'mcp')),
  name                 TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',
  tool_names           TEXT[]      NOT NULL DEFAULT '{}',
  enabled              BOOLEAN     NOT NULL DEFAULT true,
  lane                 TEXT        NOT NULL DEFAULT 'owner' CHECK (lane IN ('public', 'owner')),
  mcp_url              TEXT,
  credential_encrypted TEXT,
  credential_masked    TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
INSERT INTO connectors (id, type, name, description, tool_names, enabled, lane)
VALUES
  ('00000000-0000-0000-0000-000000000001','builtin','Booking','Let visitors check your Calendly availability and book a meeting.',ARRAY['get_availability','create_scheduling_link'],true,'public'),
  ('00000000-0000-0000-0000-000000000002','builtin','Leave a message','Let visitors send a message directly to your inbox via email.',ARRAY['leave_message'],true,'public')
ON CONFLICT (id) DO NOTHING;