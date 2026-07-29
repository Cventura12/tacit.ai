// Connector DB operations — server-side only.
// ConnectorDTO is safe to send to the client; ConnectorRow is not (contains encrypted credential).

import { getDb, isDbConfigured } from "./db";
import type { Lane } from "./tools/registry";

export interface ConnectorRow {
  id: string;
  type: "builtin" | "mcp";
  name: string;
  description: string;
  tool_names: string[];
  enabled: boolean;
  lane: Lane;
  mcp_url?: string | null;
  credential_encrypted?: string | null;
  credential_masked?: string | null;
  created_at: string;
  updated_at: string;
}

// Safe to send to the client — no credential fields.
export interface ConnectorDTO {
  id: string;
  type: "builtin" | "mcp";
  name: string;
  description: string;
  tool_names: string[];
  enabled: boolean;
  lane: Lane;
  mcp_url?: string | null;
  credential_masked?: string | null;
  created_at: string;
}

const BUILTIN_SEEDS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    type: "builtin" as const,
    name: "Booking",
    description: "Let visitors check your Calendly availability and book a meeting.",
    tool_names: ["get_availability", "create_scheduling_link"],
    enabled: true,
    lane: "public" as Lane,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    type: "builtin" as const,
    name: "Leave a message",
    description: "Let visitors send a message directly to your inbox via email.",
    tool_names: ["leave_message"],
    enabled: true,
    lane: "public" as Lane,
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    type: "builtin" as const,
    name: "Gmail (read + send)",
    description: "Read your Gmail inbox and send owner-approved draft replies.",
    tool_names: ["read_gmail"],
    enabled: false,
    lane: "owner" as Lane,
  },
];

// Upsert built-in connector rows. Idempotent — safe to call on every request.
// Only runs if Supabase is configured.
export async function ensureBuiltins(): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  for (const seed of BUILTIN_SEEDS) {
    await db
      .from("connectors")
      .upsert(seed, { onConflict: "id", ignoreDuplicates: true });
  }
}

export async function listConnectors(): Promise<ConnectorDTO[]> {
  await ensureBuiltins();
  const db = getDb();
  const { data, error } = await db
    .from("connectors")
    .select(
      "id,type,name,description,tool_names,enabled,lane,mcp_url,credential_masked,created_at"
    )
    .order("type", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to list connectors: ${error.message}`);
  return (data ?? []) as ConnectorDTO[];
}

// Returns the raw row including encrypted credential — for server-side use only.
export async function getConnectorById(id: string): Promise<ConnectorRow | null> {
  if (!isDbConfigured()) return null;
  const db = getDb();
  const { data, error } = await db
    .from("connectors")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as ConnectorRow;
}

// Returns all tool names belonging to ENABLED built-in connectors.
// Used by the agent route to determine which built-in tools to expose.
export async function getEnabledToolNames(): Promise<Set<string>> {
  if (!isDbConfigured()) {
    // Supabase not set up yet — all built-in connector tools are enabled.
    const all = new Set<string>();
    BUILTIN_SEEDS.forEach((s) => s.tool_names.forEach((n) => all.add(n)));
    return all;
  }
  await ensureBuiltins();
  const db = getDb();
  const { data, error } = await db
    .from("connectors")
    .select("tool_names,enabled")
    .eq("type", "builtin");
  if (error) throw new Error(`Failed to load connector states: ${error.message}`);

  const enabled = new Set<string>();
  for (const row of data ?? []) {
    if (row.enabled) {
      for (const name of row.tool_names ?? []) enabled.add(name);
    }
  }
  return enabled;
}

// Returns all enabled MCP connectors with their encrypted credentials.
// For server-side use only — credentials must never leave the server.
export async function getEnabledMcpConnectors(): Promise<ConnectorRow[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const { data, error } = await db
    .from("connectors")
    .select("*")
    .eq("type", "mcp")
    .eq("enabled", true);
  if (error) throw new Error(`Failed to load MCP connectors: ${error.message}`);
  return (data ?? []) as ConnectorRow[];
  
}
