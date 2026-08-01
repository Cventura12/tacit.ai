import { type NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getDb, isDbConfigured } from "@/lib/db";
import { logProposalEvent, classifyGuardedTransition } from "@/lib/t002";

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
  const decisionAt = new Date().toISOString();

  // Guarded by WHERE status = 'pending' so a proposal can't be transitioned twice
  // (e.g. a duplicate/racing PATCH after it was already sent or skipped) — the
  // decision_at timestamp and the sent/skipped event must each be recorded once.
  const { data, error } = await db
    .from("pending_proposals")
    .update({
      status,
      decision_at: decisionAt,
      outcome: status,
      ...(status === "sent" ? { sent_at: decisionAt } : { skipped_at: decisionAt }),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[owner/inbox] PATCH failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Zero rows matched the guarded UPDATE above (status was no longer 'pending' —
  // already transitioned elsewhere, or claimed by expiration first). In that
  // case none of decision_at/outcome/sent_at/skipped_at were written and no
  // event was logged for this call; classifyGuardedTransition turns that into an
  // explicit 409 rather than a false {ok:true}. NOTE: this does not make a real
  // Gmail send (which already happened, if status === "sent", before this PATCH
  // was ever called — see app/api/owner/email/send/route.ts) atomic with this
  // row's state. A 409 here means the database no longer reflects a pending
  // proposal; it does not mean the send didn't happen. See "Known integrity
  // limitation" in docs/experiments/T-002.md.
  const outcome = classifyGuardedTransition(data);

  if (data) {
    await logProposalEvent(db, id, status);
  }

  return NextResponse.json(outcome.body, { status: outcome.status });
}
