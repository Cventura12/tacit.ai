import type { ToolDefinition } from "../registry";
import { getDb } from "@/lib/db";
import { logOwnerAction } from "@/lib/owner-actions";

export const set_connector_lane: ToolDefinition = {
  name: "set_connector_lane",
  description:
    "Change an MCP connector's access lane. 'public' means any visitor can trigger its tools. " +
    "ALWAYS warn and confirm before setting to public. Omit confirmed or set false to get the warning first.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The MCP connector name.",
      },
      lane: {
        type: "string",
        enum: ["public", "owner"],
        description: "'public' (any visitor) or 'owner' (only you).",
      },
      confirmed: {
        type: "boolean",
        description: "Must be true when setting lane='public'. Omit to get the warning first.",
      },
    },
    required: ["name", "lane"],
  },
  lane: "owner",
  statusLabel: "updating connector lane…",
  execute: async (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const lane = input.lane === "public" ? "public" : "owner";
    const confirmed = input.confirmed === true;

    if (lane === "public" && !confirmed) {
      return JSON.stringify({
        requires_confirmation: true,
        action: "make_public",
        connector: name,
        warning:
          "Making this public means any visitor to your site can trigger its tools. Only proceed if the worst-case action is harmless.",
      });
    }

    const db = getDb();
    const { data, error } = await db
      .from("connectors")
      .update({ lane, updated_at: new Date().toISOString() })
      .eq("type", "mcp")
      .ilike("name", name)
      .select("id,name,lane")
      .single();

    if (error || !data) {
      return JSON.stringify({ error: `MCP connector "${name}" not found.` });
    }

    void logOwnerAction("set_connector_lane", { name: data.name, lane });
    return JSON.stringify({ ok: true, connector: data.name, lane: data.lane });
  },
};
