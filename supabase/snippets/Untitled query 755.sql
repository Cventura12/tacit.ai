-- Migration 08: make FTS search more forgiving for multi-word queries.
--
-- Previously both functions used websearch_to_tsquery which requires ALL terms
-- to match simultaneously (AND semantics). A query like "Form I-797 Notice of
-- Approval" fails if the indexed text is missing any single term, even though
-- "I-797" alone would match.
--
-- Fix: after the primary phrase match, fall back to OR-ing the individual
-- lexemes extracted from the query string (via to_tsvector on the query itself,
-- which applies the same stemming/stopword rules as the document index).
-- Fallback hits get a 0.7× score penalty so exact matches rank first.

-- ── search_document_pages_all ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS search_document_pages_all(text, int);

CREATE FUNCTION search_document_pages_all(q text, lim int DEFAULT 25)
RETURNS TABLE (doc_id uuid, title text, doc_type text, page_number int, snippet text, score real)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  ts_q        tsquery;
  ts_fallback tsquery;
  lex_str     text;
BEGIN
  -- Primary: phrase match using websearch syntax (AND semantics, supports "-").
  ts_q := websearch_to_tsquery('english', q);

  -- Fallback: OR of individual lexemes so partial matches still surface.
  -- to_tsvector on the query string applies the same dictionary as the index.
  SELECT string_agg(lexeme, ' | ')
  INTO   lex_str
  FROM   unnest(to_tsvector('english', q))
  WHERE  lexeme IS NOT NULL;

  IF lex_str IS NOT NULL THEN
    ts_fallback := to_tsquery('english', lex_str);
  END IF;

  RETURN QUERY
  SELECT
    d.id            AS doc_id,
    d.title         AS title,
    d.doc_type      AS doc_type,
    p.page_number   AS page_number,
    ts_headline(
      'english', p.text,
      CASE WHEN p.fts @@ ts_q THEN ts_q ELSE ts_fallback END,
      'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>'
    )               AS snippet,
    CASE
      WHEN p.fts @@ ts_q          THEN ts_rank(p.fts, ts_q)::real
      WHEN ts_fallback IS NOT NULL THEN (ts_rank(p.fts, ts_fallback) * 0.7)::real
      ELSE 0::real
    END             AS score
  FROM document_pages p
  JOIN documents     d ON d.id = p.doc_id
  WHERE p.fts @@ ts_q
     OR (ts_fallback IS NOT NULL AND p.fts @@ ts_fallback)
  ORDER BY score DESC
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION search_document_pages_all(text, int) TO service_role;


-- ── search_document_pages (fixed-limit variant) ───────────────────────────────

DROP FUNCTION IF EXISTS search_document_pages(text, int);

CREATE FUNCTION search_document_pages(q text, lim int DEFAULT 8)
RETURNS TABLE (doc_id uuid, title text, doc_type text, page_number int, snippet text, score real)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  ts_q        tsquery;
  ts_fallback tsquery;
  lex_str     text;
BEGIN
  ts_q := websearch_to_tsquery('english', q);

  SELECT string_agg(lexeme, ' | ')
  INTO   lex_str
  FROM   unnest(to_tsvector('english', q))
  WHERE  lexeme IS NOT NULL;

  IF lex_str IS NOT NULL THEN
    ts_fallback := to_tsquery('english', lex_str);
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.title, d.doc_type, p.page_number,
    ts_headline(
      'english', p.text,
      CASE WHEN p.fts @@ ts_q THEN ts_q ELSE ts_fallback END,
      'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>'
    ) AS snippet,
    CASE
      WHEN p.fts @@ ts_q          THEN ts_rank(p.fts, ts_q)::real
      WHEN ts_fallback IS NOT NULL THEN (ts_rank(p.fts, ts_fallback) * 0.7)::real
      ELSE 0::real
    END AS score
  FROM document_pages p
  JOIN documents     d ON d.id = p.doc_id
  WHERE p.fts @@ ts_q
     OR (ts_fallback IS NOT NULL AND p.fts @@ ts_fallback)
  ORDER BY score DESC
  LIMIT lim;
END;
$$;

GRANT EXECUTE ON FUNCTION search_document_pages(text, int) TO service_role;
