-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  title        text        NOT NULL,
  doc_type     text,
  storage_path text        NOT NULL,
  page_count   int         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS document_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number int  NOT NULL,
  text        text NOT NULL,
  fts         tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS document_pages_fts_idx    ON document_pages USING GIN (fts);
CREATE INDEX IF NOT EXISTS document_pages_doc_id_idx ON document_pages (doc_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_pages  ENABLE ROW LEVEL SECURITY;

GRANT ALL ON documents      TO service_role;
GRANT ALL ON document_pages TO service_role;

-- ── Search function ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION search_document_pages(q text, lim int DEFAULT 8)
RETURNS TABLE (doc_id uuid, title text, doc_type text, page_number int, snippet text)
LANGUAGE sql STABLE AS $$
  SELECT
    d.id, d.title, d.doc_type, p.page_number,
    ts_headline('english', p.text, websearch_to_tsquery('english', q),
      'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>') AS snippet
  FROM document_pages p
  JOIN documents d ON d.id = p.doc_id
  WHERE websearch_to_tsquery('english', q) @@ p.fts
  ORDER BY ts_rank(p.fts, websearch_to_tsquery('english', q)) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_document_pages(text, int) TO service_role;
