-- migrations-06-search-score.sql
-- Adds score (ts_rank) to search results and a _all variant for retrieval tracing.

-- ── Drop existing function first (return type is changing) ────────────────────

DROP FUNCTION IF EXISTS search_document_pages(text, int);

-- ── search_document_pages — now includes score ────────────────────────────────

CREATE FUNCTION search_document_pages(
  q   text,
  lim int DEFAULT 8
)
RETURNS TABLE (
  doc_id      uuid,
  title       text,
  doc_type    text,
  page_number int,
  snippet     text,
  score       real
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id                                                        AS doc_id,
    d.title                                                     AS title,
    d.doc_type                                                  AS doc_type,
    p.page_number                                               AS page_number,
    ts_headline(
      'english', p.text,
      websearch_to_tsquery('english', q),
      'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>'
    )                                                           AS snippet,
    ts_rank(p.fts, websearch_to_tsquery('english', q))::real   AS score
  FROM document_pages p
  JOIN documents d ON d.id = p.doc_id
  WHERE websearch_to_tsquery('english', q) @@ p.fts
  ORDER BY score DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_document_pages(text, int) TO service_role;

-- ── search_document_pages_all — top 25 candidates for retrieval tracing ───────
-- lim is accepted (for caller convenience) but ignored; always returns 25 rows.

CREATE OR REPLACE FUNCTION search_document_pages_all(
  q   text,
  lim int DEFAULT 25
)
RETURNS TABLE (
  doc_id      uuid,
  title       text,
  doc_type    text,
  page_number int,
  snippet     text,
  score       real
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id                                                        AS doc_id,
    d.title                                                     AS title,
    d.doc_type                                                  AS doc_type,
    p.page_number                                               AS page_number,
    ts_headline(
      'english', p.text,
      websearch_to_tsquery('english', q),
      'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>'
    )                                                           AS snippet,
    ts_rank(p.fts, websearch_to_tsquery('english', q))::real   AS score
  FROM document_pages p
  JOIN documents d ON d.id = p.doc_id
  WHERE websearch_to_tsquery('english', q) @@ p.fts
  ORDER BY score DESC
  LIMIT 25;
$$;

GRANT EXECUTE ON FUNCTION search_document_pages_all(text, int) TO service_role;
