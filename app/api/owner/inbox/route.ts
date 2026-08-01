import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getDb, isDbConfigured } from "@/lib/db";
import { runInboxWatch } from "@/lib/inbox-watch";
import { expireOverdueT002Proposals } from "@/lib/t002";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — list pending proposals (status = 'pending')
export async function GET() {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  if (!isDbConfigured()) return NextResponse.json({ proposals: [] });

  const db = getDb();
  await expireOverdueT002Proposals(db);

  const { data, error } = await db
    .from("pending_proposals")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load proposals" }, { status: 500 });
  }
  return NextResponse.json({ proposals: data ?? [] });
}

// POST — manual trigger: runs the inbox watch job now
export async function POST() {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const result = await runInboxWatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[owner/inbox] manual trigger error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Watch failed" },
      { status: 500 }
    );
  }
}
