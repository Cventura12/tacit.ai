import type { ToolDefinition, ToolExecutionContext } from "../registry";
import { verifySessionToken } from "@/lib/session";
import { readRecent } from "@/lib/gmail";
import { logOwnerAction } from "@/lib/owner-actions";

export const read_gmail: ToolDefinition = {
  name: "read_gmail",
  description:
    "Reads recent messages from your Gmail inbox. Returns sender, subject, snippet, date, and unread status for each message. Supports Gmail search syntax (e.g. 'is:unread', 'from:someone@example.com', 'newer_than:3d'). Read-only — cannot send, delete, or modify mail in any way.",
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
  execute: async (input, ctx: ToolExecutionContext) => {
    if (!ctx.ownerToken || !(await verifySessionToken(ctx.ownerToken))) {
      return JSON.stringify({ error: "Unauthorized" });
    }
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
