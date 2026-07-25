import type { APIRoute } from "astro";
import { listConnectors } from "@/lib/connectors";
import { encryptCredential, maskCredential } from "@/lib/crypto";
import { probeMcpTools } from "@/lib/mcp";
import { getDb } from "@/lib/db";

export const GET: APIRoute = async () => {
  try {
    const connectors = await listConnectors();
    return json({ connectors });
  } catch (err) {
    console.error("[owner/connectors] GET failed:", err);
    return json({ error: "Failed to load connectors" }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { name, mcp_url, credential, lane } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return json({ error: "name is required" }, 400);
  }
  if (typeof mcp_url !== "string" || !mcp_url.trim()) {
    return json({ error: "mcp_url is required" }, 400);
  }
  if (lane !== "public" && lane !== "owner") {
    return json({ error: "lane must be 'public' or 'owner'" }, 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(mcp_url.trim());
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return json({ error: "mcp_url must be a valid http/https URL" }, 400);
  }

  let toolNames: string[] = [];
  try {
    const rawCredential = typeof credential === "string" ? credential : undefined;
    toolNames = await probeMcpTools(parsedUrl.toString(), rawCredential);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: `Could not connect to MCP server: ${msg}` }, 422);
  }

  const rawCred = typeof credential === "string" && credential ? credential : null;
  const credentialEncrypted = rawCred ? encryptCredential(rawCred) : null;
  const credentialMasked = rawCred ? maskCredential(rawCred) : null;

  const db = getDb();
  const { data, error: dbErr } = await db
    .from("connectors")
    .insert({
      type: "mcp",
      name: name.trim(),
      description: `MCP connector at ${parsedUrl.hostname}`,
      tool_names: toolNames,
      enabled: true,
      lane,
      mcp_url: parsedUrl.toString(),
      credential_encrypted: credentialEncrypted,
      credential_masked: credentialMasked,
    })
    .select(
      "id,type,name,description,tool_names,enabled,lane,mcp_url,credential_masked,created_at"
    )
    .single();

  if (dbErr || !data) {
    console.error("[owner/connectors] POST insert failed:", dbErr);
    return json({ error: "Database error" }, 500);
  }

  return json({ connector: data }, 201);
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
