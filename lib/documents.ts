// Document storage and full-text search — server-side only.
// Stores PDFs in a private Supabase Storage bucket ('documents').
// Extracts per-page text via pdf-parse; falls back to tesseract.js OCR
// for pages with fewer than OCR_MIN_CHARS characters (image-only / scanned pages).

import { PDFParse } from "pdf-parse";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { pathToFileURL } from "url";
import { resolve } from "path";
import { getDb, isDbConfigured } from "@/lib/db";

const BUCKET = "documents";
const SIGNED_URL_TTL = 300; // 5 minutes
const OCR_MIN_CHARS = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageHit {
  doc_id: string;
  title: string;
  doc_type: string | null;
  page_number: number;
  snippet: string;
  score: number;
}

export interface SearchResult {
  hits: PageHit[];
  candidates: PageHit[];
}

export interface DocumentRow {
  id: string;
  title: string;
  doc_type: string | null;
  page_count: number;
  created_at: string;
}

export interface IngestResult {
  docId: string;
  pageCount: number;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

function requireDb() {
  if (!isDbConfigured()) throw new Error("Database is not configured");
  return getDb();
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function ensureBucket(): Promise<void> {
  const db = requireDb();
  const { error } = await db.storage.createBucket(BUCKET, { public: false });
  // Ignore "already exists" — any other error is fatal.
  if (error && !error.message.toLowerCase().includes("already exists")) {
    throw new Error(`Failed to ensure storage bucket '${BUCKET}': ${error.message}`);
  }
}

// ─── Ingest PDF ───────────────────────────────────────────────────────────────

export async function ingestPdf(
  fileName: string,
  docType: string | null,
  bytes: Buffer
): Promise<IngestResult> {
  const db = requireDb();
  const docId = crypto.randomUUID();
  const storagePath = `${docId}/${fileName}`;

  // 1. Ensure the private bucket exists.
  await ensureBucket();

  // 2. Upload the raw file to storage.
  console.log(`[documents] uploading ${fileName} → ${BUCKET}/${storagePath}`);
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    throw new Error(`Storage upload failed for '${fileName}': ${uploadError.message}`);
  }
  console.log(`[documents] upload complete`);

  // 3. Fast path: extract per-page text via pdf-parse v2 class API.
  const parser = new PDFParse({ data: bytes });
  const textResult = await parser.getText();
  await parser.destroy();
  const pageCount = textResult.total;
  console.log(`[documents] extracted ${pageCount} pages from ${fileName}`);

  // 4. Build page rows; identify pages that need OCR.
  type PageRow = { doc_id: string; page_number: number; text: string; ocr_used: boolean };
  const rows: PageRow[] = textResult.pages.map((p) => ({
    doc_id: docId,
    page_number: p.num,
    text: p.text.trim(),
    ocr_used: false,
  }));

  const sparsePageNums = new Set(
    rows.filter((r) => r.text.length < OCR_MIN_CHARS).map((r) => r.page_number)
  );

  if (sparsePageNums.size > 0) {
    console.log(`[documents] ${sparsePageNums.size} page(s) need OCR in "${fileName}"`);

    // pdfjs-dist legacy build is required in Node.js (regular build needs DOMMatrix).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as any;
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
    ).href;

    const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const ocrWorker = await createWorker("eng", 1, { logger: () => {} });

    // Collect OCR results keyed by page number. Written back into rows[] after
    // the finally block so the correct text reaches the DB insert in all cases.
    const ocrResults = new Map<number, string>();

    try {
      for (const pageNum of sparsePageNums) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
          const ctx = canvas.getContext("2d");
          await page.render({
            canvasContext: ctx as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          const { data } = await ocrWorker.recognize(canvas.toBuffer("image/png"));
          const ocrText = data.text.trim();
          ocrResults.set(pageNum, ocrText);
          console.log(`[documents] OCR page ${pageNum}: ${ocrText.length} chars`);
        } catch (err) {
          console.error(
            `[documents] OCR failed for page ${pageNum} of "${fileName}":`,
            err
          );
        }
      }
    } finally {
      await ocrWorker.terminate();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      pdfDoc.destroy();
    }

    // Apply OCR results directly into the rows array that will be inserted.
    // Doing this after finally ensures it always runs even if some pages errored.
    for (const row of rows) {
      const ocrText = ocrResults.get(row.page_number);
      if (ocrText !== undefined) {
        row.text = ocrText;
        row.ocr_used = true;
      }
    }
  }

  // 5. Insert the documents row.
  const { error: docError } = await db.from("documents").insert({
    id: docId,
    title: fileName.replace(/\.[^.]+$/, ""),
    doc_type: docType ?? null,
    storage_path: storagePath,
    page_count: pageCount,
  });
  if (docError) {
    throw new Error(`Failed to insert document row for '${fileName}': ${docError.message}`);
  }

  // 6. Bulk-insert one row per page.
  if (rows.length > 0) {
    const { error: pageError } = await db.from("document_pages").insert(rows);
    if (pageError) {
      throw new Error(`Failed to insert pages for '${fileName}': ${pageError.message}`);
    }
  }

  console.log(`[documents] ingested docId=${docId} pages=${pageCount}`);
  return { docId, pageCount };
}

// ─── Full-text search ─────────────────────────────────────────────────────────

export async function search(query: string, limit = 8): Promise<SearchResult> {
  const db = requireDb();
  const { data, error } = await db.rpc("search_document_pages_all", {
    q: query,
    lim: limit,
  });
  if (error) throw new Error(`Document search failed for '${query}': ${error.message}`);
  const candidates = (data ?? []) as PageHit[];
  const hits = candidates.slice(0, limit);
  return { hits, candidates };
}

// ─── List documents ───────────────────────────────────────────────────────────

export async function listDocuments(): Promise<DocumentRow[]> {
  const db = requireDb();
  const { data, error } = await db
    .from("documents")
    .select("id,title,doc_type,page_count,created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list documents: ${error.message}`);
  return (data ?? []) as DocumentRow[];
}

// ─── Signed URL for stored PDF ────────────────────────────────────────────────
// Returns a 5-minute signed URL with #page=<page> appended so the browser
// opens the PDF at the right page.

export async function getDocumentUrl(docId: string, page: number): Promise<string> {
  const db = requireDb();

  // Look up the storage path from the documents row.
  const { data, error: rowError } = await db
    .from("documents")
    .select("storage_path")
    .eq("id", docId)
    .single();
  if (rowError || !data) {
    throw new Error(`Document not found: ${docId}`);
  }

  const { data: signed, error: signError } = await db.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL);
  if (signError || !signed?.signedUrl) {
    throw new Error(
      `Failed to create signed URL for document ${docId}: ${signError?.message ?? "no URL returned"}`
    );
  }

  return `${signed.signedUrl}#page=${page}`;
}
