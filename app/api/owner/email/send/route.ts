import { type NextRequest, NextResponse } from "next/server";
import { sendGmail } from "@/lib/gmail";
import { logOwnerAction } from "@/lib/owner-actions";
import { getDb, isDbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "documents";

// Basic email address validation — rejects comma-separated lists (single recipient only).
function isValidEmail(addr: string): boolean {
  // Strip "Name <addr>" wrapping, then validate the extracted address.
  const inner = addr.match(/<([^>]+)>/) ? addr.match(/<([^>]+)>/)![1] : addr;
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(inner.trim());
}

// Download a document from Supabase storage by doc_id.
// Returns { filename, content, mimeType } or null if not found/inaccessible.
async function fetchAttachment(
  docId: string
): Promise<{ filename: string; content: Buffer; mimeType: string } | null> {
  if (!isDbConfigured()) return null;
  const db = getDb();

  const { data: doc } = await db
    .from("documents")
    .select("title, storage_path")
    .eq("id", docId)
    .single();

  if (!doc?.storage_path) return null;

  const { data: blob, error } = await db.storage.from(BUCKET).download(doc.storage_path);
  if (error || !blob) {
    console.warn(`[email/send] attachment download failed for ${docId}:`, error?.message);
    return null;
  }

  const arrayBuffer = await blob.arrayBuffer();
  const filename = doc.storage_path.split("/").pop() ?? `${doc.title}.pdf`;

  return {
    filename,
    content: Buffer.from(arrayBuffer),
    mimeType: "application/pdf",
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    recipient,
    subject,
    body: emailBody,
    thread_id,
    in_reply_to_id,
    attachment_doc_ids,
  } = (body ?? {}) as Record<string, unknown>;

  // ── Validate inputs ──────────────────────────────────────────────────────────

  if (typeof recipient !== "string" || !recipient.trim()) {
    return NextResponse.json({ error: "recipient is required" }, { status: 400 });
  }
  if (!isValidEmail(recipient.trim())) {
    return NextResponse.json(
      { error: "recipient must be a single valid email address" },
      { status: 400 }
    );
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  if (typeof emailBody !== "string" || !emailBody.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const docIds =
    Array.isArray(attachment_doc_ids)
      ? (attachment_doc_ids as unknown[]).filter((id): id is string => typeof id === "string")
      : [];

  // ── Fetch attachments ────────────────────────────────────────────────────────

  const attachments: { filename: string; content: Buffer; mimeType: string }[] = [];
  for (const docId of docIds) {
    const att = await fetchAttachment(docId);
    if (att) attachments.push(att);
  }

  // ── Send ─────────────────────────────────────────────────────────────────────

  let result: { message_id: string; thread_id: string };
  try {
    result = await sendGmail({
      to: recipient.trim(),
      subject: subject.trim(),
      body: emailBody.trim(),
      thread_id: typeof thread_id === "string" ? thread_id : undefined,
      in_reply_to_id: typeof in_reply_to_id === "string" ? in_reply_to_id : undefined,
      attachments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[email/send]", message);
    // Surface scope errors with a clear reconnect hint.
    const isScopeError =
      message.toLowerCase().includes("403") ||
      message.toLowerCase().includes("insufficient");
    return NextResponse.json(
      {
        error: isScopeError
          ? "Gmail send permission not granted — reconnect Gmail to add the send scope."
          : `Send failed: ${message}`,
      },
      { status: isScopeError ? 403 : 500 }
    );
  }

  const sentAt = new Date().toISOString();

  void logOwnerAction("email_sent", {
    recipient: recipient.trim(),
    subject: subject.trim(),
    message_id: result.message_id,
    attachment_count: attachments.length,
  });

  return NextResponse.json({ ok: true, message_id: result.message_id, sent_at: sentAt });
}
