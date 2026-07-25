WITH keep AS (
  SELECT DISTINCT ON (title) id
  FROM documents
  ORDER BY title, created_at ASC
)
DELETE FROM documents
WHERE id NOT IN (SELECT id FROM keep);