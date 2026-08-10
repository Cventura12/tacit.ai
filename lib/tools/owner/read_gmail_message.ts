import type { ToolDefinition } from "../registry";
import {
  readMessageBody,
  toBodyProvenance,
  describeCompletenessForOwner,
  sha256Hex,
  type MessageBodyResult,
} from "../../gmail.ts";
import { logOwnerAction } from "../../owner-actions.ts";

// Pure result-shaping, split out from execute() so it's directly testable
// without a live Gmail fetch (readMessageBody needs DB-backed auth). Given a
// MessageBodyResult, this just repackages it — it never re-derives
// completeness and never downloads attachment content (attachments here is
// always the metadata-only array MessageBodyResult already carries).
export function buildReadGmailMessageResult(
  messageId: string,
  result: MessageBodyResult
): Record<string, unknown> {
  return {
    gmail_message_id: messageId,
    text: result.text,
    content_completeness: result.content_completeness,
    locally_truncated: result.locally_truncated,
    parts_failed: result.parts_failed,
    original_character_count: result.original_character_count,
    attachments: result.attachments,
    error_codes: result.error_codes,
    status_message: describeCompletenessForOwner(result.content_completeness, result.locally_truncated),
  };
}

// The ONLY thing ever allowed to reach console logs or the persisted
// tool_runs.output_summary column for this tool: fixed, non-content fields
// picked explicitly by name (never a spread of the raw result), so a future
// field added to buildReadGmailMessageResult can't silently start leaking
// here. No text, no attachment filenames (which may themselves carry
// sensitive content — e.g. "SSN scan.pdf") — attachment_count only.
export function buildReadGmailMessageLogSummary(parsed: Record<string, unknown>): Record<string, unknown> {
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  return {
    tool: "read_gmail_message",
    gmail_message_id: typeof parsed.gmail_message_id === "string" ? parsed.gmail_message_id : null,
    content_completeness:
      typeof parsed.content_completeness === "string" ? parsed.content_completeness : null,
    locally_truncated: typeof parsed.locally_truncated === "boolean" ? parsed.locally_truncated : null,
    parts_failed: typeof parsed.parts_failed === "number" ? parsed.parts_failed : null,
    original_character_count:
      typeof parsed.original_character_count === "number" ? parsed.original_character_count : null,
    attachment_count: attachments.length,
    error_codes: Array.isArray(parsed.error_codes)
      ? parsed.error_codes.filter((c): c is string => typeof c === "string")
      : [],
  };
}

// Retrieves the COMPLETE body of one Gmail message by id — the interactive
// counterpart to lib/inbox-watch.ts's automated readMessageBody() call.
// read_gmail (listing) intentionally stays snippet-only; this tool is how the
// owner-chat agent gets the real body before treating any detail as confirmed
// or calling handle_email.
//
// Trust boundary: after a genuine fetch, this writes the resulting text AND
// provenance — bound together, never provenance alone — into
// ctx.gmailTrustedMessageCache, keyed by gmail_message_id. A server-side side
// effect the model cannot see or influence beyond choosing which message id to
// request. A later handle_email call for the SAME id (within the same
// request) picks up the cached TEXT (overriding whatever email_text the model
// supplies) and its provenance automatically; see
// lib/gmail.ts:resolveTrustedEmailContent.
export const read_gmail_message: ToolDefinition = {
  name: "read_gmail_message",
  description:
    "Retrieves the COMPLETE body of a single Gmail message by id, plus how completely it was actually retrieved (full, partial, snippet-only, or failed). Call this before confirming any deadline, dollar amount, required action, link, or eligibility detail, and before drafting a reply with handle_email — read_gmail's snippet is only a preview, not the message. Never downloads file attachment contents, only lists their metadata (filename, type, size).",
  input_schema: {
    type: "object",
    properties: {
      gmail_message_id: {
        type: "string",
        description: "The Gmail message id to retrieve, e.g. from a prior read_gmail result.",
      },
    },
    required: ["gmail_message_id"],
  },
  lane: "owner",
  statusLabel: "reading the full message…",
  execute: async (input, ctx) => {
    const messageId = typeof input.gmail_message_id === "string" ? input.gmail_message_id.trim() : "";
    if (!messageId) return JSON.stringify({ error: "gmail_message_id is required" });

    const result = await readMessageBody(messageId);

    void logOwnerAction("read_gmail_message", {
      gmail_message_id: messageId,
      completeness: result.content_completeness,
    });

    // Trusted write: only genuine retrieval results ever land here, keyed by
    // the id that was actually fetched — never anything the model supplies.
    // Binds text + provenance together so a later handle_email call can't be
    // given different text while still claiming this id's completeness.
    if (ctx.gmailTrustedMessageCache) {
      ctx.gmailTrustedMessageCache.set(messageId, {
        text: result.text,
        textHash: sha256Hex(result.text),
        provenance: toBodyProvenance(result),
      });
    }

    return JSON.stringify(buildReadGmailMessageResult(messageId, result));
  },
};
