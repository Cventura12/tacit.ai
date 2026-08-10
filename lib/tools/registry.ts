import type { EmailBodyProvenance, TrustedGmailMessage } from "@/lib/gmail";
import { get_current_time } from "./get_current_time";
import { get_availability } from "./get_availability";
import { create_scheduling_link } from "./create_scheduling_link";
import { leave_message } from "./leave_message";
import { owner_ping } from "./owner_ping";
import { list_visitors } from "./owner/list_visitors";
import { read_gmail } from "./owner/read_gmail";
import { read_gmail_message } from "./owner/read_gmail_message";
import { get_connector_status } from "./owner/get_connector_status";
import { toggle_connector } from "./owner/toggle_connector";
import { list_mcp_connectors } from "./owner/list_mcp_connectors";
import { set_connector_lane } from "./owner/set_connector_lane";
import { toggle_mcp_connector } from "./owner/toggle_mcp_connector";
import { search_documents } from "./owner/search_documents";
import { handle_email } from "./owner/handle_email";
import { cross_reference } from "./owner/cross_reference";
import { fetch_webpage } from "./owner/fetch_webpage";
import { search_web } from "./owner/search_web";

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

  // ── Trusted Gmail body provenance — never model-controlled ──────────────────
  // Both fields below are how handle_email learns how completely an email body
  // was actually retrieved, WITHOUT that information ever passing through the
  // model's own tool-call JSON (which the model could otherwise forge to claim
  // a full retrieval that didn't happen). Only trusted, non-LLM server code may
  // populate either field — see lib/tools/owner/handle_email.ts's trusted
  // provenance resolution and lib/tools/owner/read_gmail_message.ts.

  // Set directly by a caller that already has a MessageBodyResult in hand and
  // is invoking handle_email.execute() itself in TypeScript, bypassing the
  // model entirely (e.g. lib/inbox-watch.ts's automated pipeline). The caller
  // is trusted to also pass the exact matching text as email_text in the same
  // call — no override is needed here.
  emailBodyProvenance?: EmailBodyProvenance;

  // Request-scoped cache, keyed by gmail_message_id, for the interactive
  // agent-loop path. Written only by read_gmail_message's execute() after it
  // has genuinely fetched and parsed that message — binding the id to BOTH
  // the exact retrieved text and its provenance (never provenance alone; see
  // lib/gmail.ts:resolveTrustedEmailContent for why keying trust off the id
  // alone would be insufficient). handle_email's execute() reads from this
  // cache using the gmail_message_id the model supplies — the model can
  // choose WHICH id to reference (that's legitimate; it can only reference
  // ids it has actually seen), but it can never control WHAT text or
  // provenance is associated with an id, since only trusted fetch code ever
  // writes into this map, and a hit here overrides the model's own email_text
  // argument entirely. The route handler constructs one Map per request and
  // passes the same reference to every tool call in that request, so a
  // read_gmail_message call earlier in the loop is visible to a handle_email
  // call later in the same loop.
  gmailTrustedMessageCache?: Map<string, TrustedGmailMessage>;
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
  read_gmail_message,
  get_connector_status,
  toggle_connector,
  list_mcp_connectors,
  set_connector_lane,
  toggle_mcp_connector,
  search_documents,
  handle_email,
  cross_reference,
  fetch_webpage,
  search_web,
];
