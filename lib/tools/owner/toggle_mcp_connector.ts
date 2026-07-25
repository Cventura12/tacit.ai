import type { ToolDefinition } from "../registry";
import { getDb } from "@/lib/db";
import { logOwnerAction } from "@/lib/owner-actions";

export const toggle_mcp_connector: ToolDefinition = {
  name: "toggle_mcp_connector",
  description:
    "Enable or disable an MCP connector by name. When disabling, omit confirmed to get a confirmation prompt first, then call again with confirmed=true on user yes.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The MCP connector name.",
      },
      enabled: {
        type: "boolean",
        description: "true to enable, false to disable.",
      },
      confirmed: {
        type: "boolean",
        description: "Must be true when disabling. Omit or false to get a confirmation request first.",
      },
    },
    required: ["name", "enabled"],
  },
  lane: "owner",
  statusLabel: "updating that connector…",
  execute: async (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const enabled = input.enabled === true;
    const confirmed = input.confirmed === true;

    if (!enabled && !confirmed) {
      return JSON.stringify({
        requires_confirmation: true,
        action: "disable",
        connector: name,
      });
    }

    const db = getDb();
    const { data, error } = await db
      .from("connectors")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("type", "mcp")
      .ilike("name", name)
      .select("id,name,enabled")
      .single();

    if (error || !data) {
      return JSON.stringify({ error: `MCP connector "${name}" not found.` });
    }

    void logOwnerAction("toggle_mcp_connector", { name: data.name, enabled });
    return JSON.stringify({ ok: true, connector: data.name, enabled: data.enabled });
  },
};
