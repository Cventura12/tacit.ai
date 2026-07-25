import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import type { Database } from "@/lib/db";

type ConnectorUpdate = Database["public"]["Tables"]["connectors"]["Update"];

export const PATCH: APIRoute = async ({ request, params }) => {
  const { id } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { enabled, lane } = body as Record<string, unknown>;
  const updates: ConnectorUpdate = {};

  if (typeof enabled === "boolean") updates.enabled = enabled;
  if (lane === "public" || lane === "owner") updates.lane = lane as string;

  if (Object.keys(updates).length === 0) {
    return json({ error: "No valid fields to update" }, 400);
  }

  updates.updated_at = new Date().toISOString();

  const db = getDb();
  const { data, error } = await db
    .from("connectors")
    .update(updates)
    .eq("id", id!)
    .select(
      "id,type,name,description,tool_names,enabled,lane,mcp_url,credential_masked,created_at"
    )
    .single();

  if (error || !data) {
    console.error("[owner/connectors] PATCH failed:", error);
    return json({ error: "Not found or update failed" }, 404);
  }

  return json({ connector: data });
};

export const DELETE: APIRoute = async ({ params }) => {
  const { id } = params;
  const db = getDb();

  const { data: existing } = await db
    .from("connectors")
    .select("type")
    .eq("id", id!)
    .single();

  if (!existing) {
    return json({ error: "Not found" }, 404);
  }
  if (existing.type === "builtin") {
    return json({ error: "Built-in connectors cannot be removed" }, 403);
  }

  const { error } = await db.from("connectors").delete().eq("id", id!);
  if (error) {
    console.error("[owner/connectors] DELETE failed:", error);
    return json({ error: "Delete failed" }, 500);
  }

  return json({ ok: true });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
