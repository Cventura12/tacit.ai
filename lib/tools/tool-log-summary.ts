// Decides what's safe to log/persist for a tool's raw JSON result. Only tools
// known to return message content (body text, snippets) are listed here —
// everything else keeps app/api/chat/route.ts's prior slice-based logging,
// unchanged by this file. Adding a new privacy-sensitive tool means adding an
// explicit branch here — never a default that assumes safety.
//
// This module intentionally has no @/-aliased imports so it (and everything
// it depends on) can be exercised directly by Node's native test runner
// without a build step — see lib/tools/tool-log-summary.test.ts.
// buildReadGmailLogSummary lives here rather than in owner/read_gmail.ts
// specifically because that file imports @/lib/gmail (alias, unresolvable by
// the test runner) — keeping this function here, with no such import, is what
// makes it directly testable.

import { buildReadGmailMessageLogSummary } from "./owner/read_gmail_message.ts";

const REDACTED_TOOLS = new Set(["read_gmail_message", "read_gmail"]);

// read_gmail's results already carry sender/subject/snippet text (the whole
// point of a listing tool) — none of that may propagate into logs or
// persisted summaries, so this deliberately keeps only a count, never the
// message array itself.
export function buildReadGmailLogSummary(parsed: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  return {
    tool: "read_gmail",
    count: messages.length,
  };
}

// Returns undefined for any tool not in REDACTED_TOOLS — callers fall back to
// their existing (pre-existing, unchanged) logging behavior in that case.
export function buildSafeToolLogSummary(toolName: string, rawResult: string): string | undefined {
  if (!REDACTED_TOOLS.has(toolName)) return undefined;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawResult) as Record<string, unknown>;
  } catch {
    // Malformed JSON from a content-bearing tool — never fall back to slicing
    // the raw text just because it didn't parse. A tool-name-only marker is
    // the safe default for an unparseable result.
    return JSON.stringify({ tool: toolName, note: "unparseable result" });
  }

  const summary =
    toolName === "read_gmail_message"
      ? buildReadGmailMessageLogSummary(parsed)
      : buildReadGmailLogSummary(parsed);
  return JSON.stringify(summary);
}
