import { type NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getDb, isDbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH — update proposal status ('sent' | 'skipped')
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const { id } = await params;

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = (body as Record<string, unknown>).status;
  if (status !== "sent" && status !== "skipped") {
    return NextResponse.json({ error: "status must be 'sent' or 'skipped'" }, { status: 400 });
  }

  const db = getDb();
  const { error } = await db
    .from("pending_proposals")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("[owner/inbox] PATCH failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
