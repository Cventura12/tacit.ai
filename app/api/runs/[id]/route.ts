import { type NextRequest, NextResponse } from "next/server";
import { getDb, isDbConfigured } from "@/lib/db";
import type { RunDetail, ToolRunDetail, RetrievalTrace } from "@/lib/types";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const { id } = await params;

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const db = getDb();

  const { data: run, error: runErr } = await db
    .from("agent_runs")
    .select("id,user_query,duration_ms,tool_count,error,created_at")
    .eq("id", id)
    .single();

  if (runErr || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const { data: toolRunRows, error: trErr } = await db
    .from("tool_runs")
    .select("id,tool_name,input,output_summary,duration_ms,success,error,sequence")
    .eq("run_id", id)
    .order("sequence", { ascending: true });

  if (trErr) {
    return NextResponse.json({ error: "Failed to load tool runs" }, { status: 500 });
  }

  const rows = toolRunRows ?? [];

  const tool_runs: ToolRunDetail[] = await Promise.all(
    rows.map(async (tr) => {
      const { data: traces } = await db
        .from("retrieval_traces")
        .select("id,doc_id,doc_title,page_number,score,returned")
        .eq("tool_run_id", tr.id)
        .order("score", { ascending: false });

      return {
        ...tr,
        input: (tr.input ?? {}) as Record<string, unknown>,
        error: tr.error ?? null,
        retrieval_traces: (traces ?? []) as RetrievalTrace[],
      } as ToolRunDetail;
    })
  );

  const detail: RunDetail = {
    ...(run as Omit<RunDetail, "tool_runs">),
    tool_runs,
  };

  return NextResponse.json(detail);
}
