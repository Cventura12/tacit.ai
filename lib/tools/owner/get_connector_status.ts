import type { ToolDefinition } from "../registry";
import { listConnectors } from "@/lib/connectors";

export const get_connector_status: ToolDefinition = {
  name: "get_connector_status",
  description:
    "Returns all connectors (built-in and MCP) with their enabled/disabled state and lane. Use when asked what's connected, what tools are on/off, or the current connector setup.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  lane: "owner",
  statusLabel: "checking your connectors…",
  execute: async () => {
    const connectors = await listConnectors();
    return JSON.stringify({ connectors });
  },
};
