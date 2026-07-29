import { NextResponse } from "next/server";
import { getDb, isDbConfigured } from "@/lib/db";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  if (!isDbConfigured()) {
    return NextResponse.json({ runs: [] });
  }
  const db = getDb();
  const { data, error } = await db
    .from("agent_runs")
    .select("id,created_at,user_query,duration_ms,tool_count,error")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[owner/runs] list failed:", error);
    return NextResponse.json({ error: "Failed to load runs" }, { status: 500 });
  }
  return NextResponse.json({ runs: data ?? [] });
}
