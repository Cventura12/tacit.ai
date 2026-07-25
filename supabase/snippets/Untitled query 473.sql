-- Documents: one row per uploaded file
CREATE TABLE IF NOT EXISTS documents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title       TEXT        NOT NULL,
  doc_type    TEXT,
  storage_path TEXT       NOT NULL,
  page_count  INTEGER     NOT NULL DEFAULT 0
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Document pages: one row per page, with full-text search
CREATE TABLE IF NOT EXISTS document_pages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER     NOT NULL,
  text        TEXT        NOT NULL DEFAULT '',
  fts         tsvector    GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
ALTER TABLE document_pages ENABLE ROW LEVEL SECURITY;

-- Index for fast full-text search
CREATE INDEX IF NOT EXISTS document_pages_fts_idx ON document_pages USING GIN (fts);
CREATE INDEX IF NOT EXISTS document_pages_doc_idx ON document_pages (doc_id);

-- Grant the service role access (same as we did for the other tables)
GRANT ALL ON documents TO service_role;
GRANT ALL ON document_pages TO service_role;