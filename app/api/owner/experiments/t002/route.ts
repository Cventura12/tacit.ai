import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getDb, isDbConfigured } from "@/lib/db";
import { computeT002Metrics, expireOverdueT002Proposals, T002_OBSERVATION_HOURS } from "@/lib/t002";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — owner-only. Runs expiration (server-side, no client timers) then returns
// the full T-002 metrics payload. Early observational data — not causal evidence;
// see docs/experiments/T-002.md.
export async function GET() {
  const check = await requireOwner();
  if (!check.ok) return check.response;

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const db = getDb();
  await expireOverdueT002Proposals(db);
  const metrics = await computeT002Metrics(db);

  return NextResponse.json({ metrics, observationHours: T002_OBSERVATION_HOURS });
}
