import type { ToolDefinition } from "../registry";
import { readRecent } from "@/lib/gmail";
import { logOwnerAction } from "@/lib/owner-actions";

// The safe log/tool_runs summary for this tool's results lives in
// ../tool-log-summary.ts (buildReadGmailLogSummary), not here — that module
// has no @/-aliased imports, which keeps it directly testable under Node's
// native test runner (this file can't be imported directly by tests for that
// reason; see read_gmail.test.ts's own comment).

export const read_gmail: ToolDefinition = {
  name: "read_gmail",
  description:
    "Reads recent messages from your Gmail inbox. Returns sender, subject, a short PREVIEW SNIPPET (not the full message), date, and unread status for each message. Supports Gmail search syntax (e.g. 'is:unread', 'from:someone@example.com', 'newer_than:3d'). Read-only — cannot send, delete, or modify mail in any way. Use read_gmail_message to get a specific message's complete body before confirming details or drafting a reply — the snippet here is a preview only.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Gmail search query (default: \"is:unread newer_than:7d\"). Supports full Gmail search syntax.",
      },
      max: {
        type: "number",
        description: "Number of messages to return (default 10, max 25).",
      },
    },
    required: [],
  },
  lane: "owner",
  statusLabel: "reading your inbox…",
  execute: async (input) => {
    const query =
      typeof input.query === "string" && input.query.trim()
        ? input.query.trim()
        : "is:unread newer_than:7d";
    const max = typeof input.max === "number" ? Math.min(input.max, 25) : 10;
    try {
      const messages = await readRecent(query, max);
      void logOwnerAction("read_gmail", { query, max, count: messages.length });
      return JSON.stringify({ messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error reading Gmail";
      console.error("[read_gmail]", message);
      return JSON.stringify({ error: message });
    }
  },
};
