import { type NextRequest, NextResponse } from "next/server";
import { logOwnerAction } from "@/lib/owner-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { classification, reason, draft_reply, suggested_attachments } =
    (body ?? {}) as Record<string, unknown>;

  await logOwnerAction("email_approved", {
    classification,
    reason,
    draft_reply: typeof draft_reply === "string" ? draft_reply.slice(0, 2000) : null,
    suggested_attachments,
  });

  return NextResponse.json({ ok: true });
}
