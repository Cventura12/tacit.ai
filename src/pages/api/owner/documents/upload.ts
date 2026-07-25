import type { APIRoute } from "astro";
import { ingestPdf } from "@/lib/documents";
import { logOwnerAction } from "@/lib/owner-actions";

const MAX_BYTES = 20 * 1024 * 1024;

export const POST: APIRoute = async ({ request }) => {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Invalid form data" }, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json({ error: "file field is required" }, 400);
  }
  if (file.type !== "application/pdf") {
    return json({ error: "Only PDF files are supported" }, 415);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: "File exceeds 20 MB limit" }, 413);
  }

  const docType = formData.get("doc_type");
  const title = file.name.replace(/\.[^.]+$/, "");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { docId, pageCount } = await ingestPdf(
      file.name,
      typeof docType === "string" && docType.trim() ? docType.trim() : null,
      buffer
    );
    void logOwnerAction("upload_document", { docId, pageCount, title });
    return json({ ok: true, docId, pageCount, title }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[documents/upload]", message);
    return json({ error: message }, 500);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
