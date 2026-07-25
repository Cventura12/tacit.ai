import { get_current_time } from "./get_current_time";
import { get_availability } from "./get_availability";
import { create_scheduling_link } from "./create_scheduling_link";
import { leave_message } from "./leave_message";
import { owner_ping } from "./owner_ping";
import { list_visitors } from "./owner/list_visitors";
import { read_gmail } from "./owner/read_gmail";
import { get_connector_status } from "./owner/get_connector_status";
import { toggle_connector } from "./owner/toggle_connector";
import { list_mcp_connectors } from "./owner/list_mcp_connectors";
import { set_connector_lane } from "./owner/set_connector_lane";
import { toggle_mcp_connector } from "./owner/toggle_mcp_connector";
import { search_documents } from "./owner/search_documents";
import { handle_email } from "./owner/handle_email";

// ─── Tool registry types ──────────────────────────────────────────────────────

export type Lane = "public" | "owner";

// Passed by the route handler to every tool execute() call.
// Tools that don't need it can simply omit the parameter — TypeScript allows
// functions with fewer parameters to be assigned to this interface.
export interface ToolExecutionContext {
  ip: string;
  sessionId?: string;
  // Raw session token — owner tools independently re-verify this before acting.
  // Only populated when the request carries a valid owner session.
  ownerToken?: string;
  // Emit an incremental status event to the SSE stream mid-tool-run.
  // Used by long-running tools like handle_email to report sub-steps.
  onStatus?: (label: string) => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Controls which request contexts may see and execute this tool.
  // "public" — any visitor may trigger it.
  // "owner"  — only authenticated owner requests.
  // Enforced both at tool-list time and at execution time (double-checked
  // before execute() is called in the agent loop).
  lane: Lane;
  // Present-progressive label shown to the visitor while the tool runs.
  statusLabel: string;
  execute: (input: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────
// Add new tools here. The agent loop reads this array — no other wiring needed.

export const TOOL_REGISTRY: ToolDefinition[] = [
  // Public tools
  get_current_time,
  get_availability,
  create_scheduling_link,
  leave_message,
  // Owner tools
  owner_ping,
  list_visitors,
  read_gmail,
  get_connector_status,
  toggle_connector,
  list_mcp_connectors,
  set_connector_lane,
  toggle_mcp_connector,
  search_documents,
  handle_email,
];
