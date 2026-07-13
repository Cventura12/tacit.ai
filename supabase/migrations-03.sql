-- migrations-03.sql
-- Seed the Gmail (read-only) builtin connector row.
-- No new columns — uses existing connectors schema.
--
-- The row starts disabled with no credential.
-- When the owner completes the Google OAuth flow, the callback route
-- (app/api/owner/gmail/callback/route.ts) sets credential_encrypted
-- and flips enabled to true via saveRefreshTokenFromCode().
--
-- ON CONFLICT DO NOTHING: safe to re-run; never overwrites a live token.

INSERT INTO connectors (id, type, name, description, tool_names, enabled, lane)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  'builtin',
  'Gmail (read-only)',
  'Read your Gmail inbox as owner. Never sends, deletes, or modifies mail.',
  ARRAY['read_gmail'],
  false,
  'owner'
)
ON CONFLICT (id) DO NOTHING;
