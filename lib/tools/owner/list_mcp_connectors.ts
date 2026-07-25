import type { ToolDefinition } from "../registry";
import { getDb, isDbConfigured } from "@/lib/db";

export const list_mcp_connectors: ToolDefinition = {
  name: "list_mcp_connectors",
  description:
    "Lists all MCP connectors with their enabled state, access lane, and URL. Use when asked about MCP connectors or custom integrations.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  lane: "owner",
  statusLabel: "checking MCP connectors…",
  execute: async () => {
    if (!isDbConfigured()) {
      return JSON.stringify({ connectors: [] });
    }
    const db = getDb();
    const { data, error } = await db
      .from("connectors")
      .select(
        "id,name,description,tool_names,enabled,lane,mcp_url,credential_masked,created_at"
      )
      .eq("type", "mcp")
      .order("created_at", { ascending: true });
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ connectors: data ?? [] });
  },
};
