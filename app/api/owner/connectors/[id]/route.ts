import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Database } from "@/lib/db";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectorUpdate = Database["public"]["Tables"]["connectors"]["Update"];
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { enabled, lane } = body as Record<string, unknown>;
  const updates: ConnectorUpdate = {};

  if (typeof enabled === "boolean") updates.enabled = enabled;
  if (lane === "public" || lane === "owner") updates.lane = lane as string;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const db = getDb();
  const { data, error } = await db
    .from("connectors")
    .update(updates)
    .eq("id", id)
    .select(
      "id,type,name,description,tool_names,enabled,lane,mcp_url,credential_masked,created_at"
    )
    .single();

  if (error || !data) {
    console.error("[owner/connectors] PATCH failed:", error);
    return NextResponse.json({ error: "Not found or update failed" }, { status: 404 });
  }

  return NextResponse.json({ connector: data });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const { id } = await params;
  const db = getDb();

  const { data: existing } = await db
    .from("connectors")
    .select("type")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.type === "builtin") {
    return NextResponse.json({ error: "Built-in connectors cannot be removed" }, { status: 403 });
  }

  const { error } = await db.from("connectors").delete().eq("id", id);
  if (error) {
    console.error("[owner/connectors] DELETE failed:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
