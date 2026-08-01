import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getDb, isDbConfigured } from "@/lib/db";
import { logProposalEvent, classifyFirstView } from "@/lib/t002";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// POST — idempotent, owner-authenticated, server-timestamped first-view marker.
// Only writes first_viewed_at when the row is currently pending AND unviewed, so
// a stale client re-opening an already-expired/sent/skipped card can never write
// a "viewed" timestamp (or log a "viewed" event) for it. Safe under concurrent
// requests: the UPDATE...WHERE guard is enforced atomically by Postgres row
// locking, so at most one caller's UPDATE can affect the row.
export async function POST(_request: Request, { params }: RouteContext) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const { id } = await params;

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const db = getDb();
  const { data, error } = await db
    .from("pending_proposals")
    .update({ first_viewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .is("first_viewed_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[owner/inbox/view] update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Zero rows matched for one of three reasons — disambiguate with a read-only
  // follow-up lookup (not a write, so it cannot itself race the UPDATE above):
  // not found, no longer pending (expired/sent/skipped — including a stale
  // client reopening an old card), or already viewed (the common, idempotent
  // no-op case on every re-expand).
  let currentRow: { status: string; first_viewed_at: string | null } | null = null;
  if (!data) {
    const { data: current } = await db
      .from("pending_proposals")
      .select("status, first_viewed_at")
      .eq("id", id)
      .maybeSingle();
    currentRow = current;
  }

  const outcome = classifyFirstView(data, currentRow);

  if (outcome.viewed) {
    await logProposalEvent(db, id, "viewed");
  }

  return NextResponse.json(outcome.body, { status: outcome.status });
}
