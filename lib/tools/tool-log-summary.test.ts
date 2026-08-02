import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSafeToolLogSummary, buildReadGmailLogSummary } from "./tool-log-summary.ts";

const here = dirname(fileURLToPath(import.meta.url));

// ── buildReadGmailLogSummary ──────────────────────────────────────────────────

test("buildReadGmailLogSummary — snippets/sender/subject never appear, only a count", () => {
  const raw = {
    messages: [
      { id: "1", from: "Jane <jane@example.com>", subject: "Re: your case", snippet: "the deadline is April 1st, please pay $9,000", date: "", unread: true },
      { id: "2", from: "Bob <bob@example.com>", subject: "Follow up", snippet: "another confidential detail", date: "", unread: false },
    ],
  };
  const summary = buildReadGmailLogSummary(raw);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes("April 1st"));
  assert.ok(!serialized.includes("$9,000"));
  assert.ok(!serialized.includes("jane@example.com"));
  assert.ok(!serialized.includes("your case"));
  assert.deepEqual(summary, { tool: "read_gmail", count: 2 });
});

test("buildReadGmailLogSummary — a non-array/missing messages field yields count 0, never throws", () => {
  assert.deepEqual(buildReadGmailLogSummary({}), { tool: "read_gmail", count: 0 });
  assert.deepEqual(buildReadGmailLogSummary({ error: "boom" }), { tool: "read_gmail", count: 0 });
});

// ── buildSafeToolLogSummary (dispatcher) ──────────────────────────────────────

test("buildSafeToolLogSummary — read_gmail_message: raw body text never appears in the returned string", () => {
  const rawResult = JSON.stringify({
    gmail_message_id: "msg-1",
    text: "SECRET_BODY_TEXT_MARKER: the deadline is April 1st, pay $9,000.",
    content_completeness: "full",
    locally_truncated: false,
    parts_failed: 0,
    original_character_count: 65,
    attachments: [],
    error_codes: [],
    status_message: "Full message retrieved",
  });
  const summary = buildSafeToolLogSummary("read_gmail_message", rawResult);
  assert.ok(summary !== undefined);
  assert.ok(!summary!.includes("SECRET_BODY_TEXT_MARKER"));
  assert.ok(!summary!.includes("April 1st"));
  assert.ok(!summary!.includes("$9,000"));
  assert.ok(summary!.includes("msg-1"));
  assert.ok(summary!.includes("full"));
});

test("buildSafeToolLogSummary — read_gmail: snippets never appear, only a count", () => {
  const rawResult = JSON.stringify({
    messages: [{ id: "1", from: "a@b.com", subject: "s", snippet: "CONFIDENTIAL_SNIPPET_MARKER", date: "", unread: true }],
  });
  const summary = buildSafeToolLogSummary("read_gmail", rawResult);
  assert.ok(summary !== undefined);
  assert.ok(!summary!.includes("CONFIDENTIAL_SNIPPET_MARKER"));
  assert.deepEqual(JSON.parse(summary!), { tool: "read_gmail", count: 1 });
});

test("buildSafeToolLogSummary — untouched tools (e.g. handle_email, search_documents) are not redacted here", () => {
  const rawResult = JSON.stringify({ status: "proposal_ready", _proposal: { draft_reply: "some draft text" } });
  const summary = buildSafeToolLogSummary("handle_email", rawResult);
  assert.equal(summary, undefined, "route.ts falls back to its existing slice-based logging for tools not in REDACTED_TOOLS");
});

test("buildSafeToolLogSummary — malformed JSON from a content-bearing tool never falls back to slicing raw text", () => {
  const summary = buildSafeToolLogSummary("read_gmail_message", "not valid json {{{");
  assert.ok(summary !== undefined);
  assert.ok(!summary!.includes("not valid json"));
  assert.deepEqual(JSON.parse(summary!), { tool: "read_gmail_message", note: "unparseable result" });
});

// ── Static check on app/api/chat/route.ts's wiring ────────────────────────────
// route.ts itself can't be imported by Node's test runner (it pulls in
// Next.js/@/-aliased modules), so these are source-text checks proving the
// wiring is correct — the same established pattern used elsewhere in this
// codebase for route-level static verification.

function readRouteSource(): string {
  return readFileSync(resolve(here, "..", "..", "app", "api", "chat", "route.ts"), "utf-8");
}

test("route.ts — buildSafeToolLogSummary is used for both the console log and the tool_runs output_summary", () => {
  const source = readRouteSource();
  assert.match(source, /safeLogSummary = buildSafeToolLogSummary\(tu\.name, result\)/);
  // The success console.log call must use safeLogSummary with a fallback to
  // the old slice-based behavior — not slice unconditionally.
  const consoleLogLine = source.split("\n").find((l) => l.includes("console.log") && l.includes("succeeded:"));
  assert.ok(consoleLogLine, "expected a console.log line logging tool success");
  assert.ok(consoleLogLine!.includes("safeLogSummary ?? result.slice(0, 300)"));
  assert.match(source, /output_summary: safeLogSummary \?\? result\.slice\(0, 500\)/);
});

test("route.ts — the model-facing tool-result channel still sends the untouched, full result", () => {
  const source = readRouteSource();
  // Two toolResults.push({...}) blocks exist: an early "tool not available"
  // error path, and the real per-tool-call result push. This finds the LAST
  // one — the one that runs after a tool actually executed — not the first.
  const pushIdx = source.lastIndexOf("toolResults.push({");
  assert.ok(pushIdx > 0);
  const pushBlock = source.slice(pushIdx, pushIdx + 200);
  assert.ok(pushBlock.includes('tool_use_id: tu.id'));
  // The content sent back to Claude must be the raw `result` variable, never
  // the redacted safeLogSummary — the model needs the real body to draft from.
  assert.match(pushBlock, /content:\s*result\s*,/);
  assert.ok(!pushBlock.includes("safeLogSummary"), "the model tool-result channel must never be swapped for the safe log summary");
});

test("route.ts — gmailTrustedMessageCache (not the old provenance-only cache) is what's threaded through tool execution", () => {
  const source = readRouteSource();
  assert.match(source, /gmailTrustedMessageCache = new Map</);
  assert.match(source, /gmailTrustedMessageCache,\s*\n\s*\}\)/);
  assert.ok(!source.includes("gmailBodyProvenanceCache"), "the old provenance-only cache field must not remain anywhere in route.ts");
});
