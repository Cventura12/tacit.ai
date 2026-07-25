-- Add per-page OCR tracking to document_pages.
ALTER TABLE document_pages
  ADD COLUMN IF NOT EXISTS ocr_used boolean NOT NULL DEFAULT false;
