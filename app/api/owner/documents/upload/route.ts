import { type NextRequest, NextResponse } from "next/server";
import { ingestPdf } from "@/lib/documents";
import { logOwnerAction } from "@/lib/owner-actions";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 20 MB limit" }, { status: 413 });
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
    return NextResponse.json({ ok: true, docId, pageCount, title }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[documents/upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
