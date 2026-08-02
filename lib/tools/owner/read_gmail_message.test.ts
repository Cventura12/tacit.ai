import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReadGmailMessageResult, buildReadGmailMessageLogSummary } from "./read_gmail_message.ts";
import type { MessageBodyResult } from "../../gmail.ts";

function fakeMessageBodyResult(overrides: Partial<MessageBodyResult> = {}): MessageBodyResult {
  return {
    text: "The full retrieved message body.",
    content_completeness: "full",
    locally_truncated: false,
    parts_failed: 0,
    original_character_count: 33,
    attachments: [],
    error_codes: [],
    ...overrides,
  };
}

test("buildReadGmailMessageResult — full retrieval maps through unchanged", () => {
  const result = buildReadGmailMessageResult("msg-1", fakeMessageBodyResult());
  assert.equal(result.content_completeness, "full");
  assert.equal(result.text, "The full retrieved message body.");
  assert.equal(result.status_message, "Full message retrieved");
});

test("buildReadGmailMessageResult — an HTML-derived body passes through as ordinary text", () => {
  // htmlToText already converted this upstream — this tool doesn't re-parse it,
  // just repackages whatever MessageBodyResult it was given.
  const htmlDerived = fakeMessageBodyResult({ text: "Hello world\n\nSecond paragraph." });
  const result = buildReadGmailMessageResult("msg-2", htmlDerived);
  assert.equal(result.text, "Hello world\n\nSecond paragraph.");
  assert.equal(result.content_completeness, "full");
});

test("buildReadGmailMessageResult — partial state is preserved, not upgraded", () => {
  const result = buildReadGmailMessageResult(
    "msg-3",
    fakeMessageBodyResult({ content_completeness: "partial", parts_failed: 1, error_codes: ["GMAIL_BASE64_DECODE_FAILED"] })
  );
  assert.equal(result.content_completeness, "partial");
  assert.equal(result.parts_failed, 1);
  assert.deepEqual(result.error_codes, ["GMAIL_BASE64_DECODE_FAILED"]);
  assert.equal(result.status_message, "Message partially parsed — some parts could not be read");
});

test("buildReadGmailMessageResult — snippet_only state is preserved, not upgraded", () => {
  const result = buildReadGmailMessageResult(
    "msg-4",
    fakeMessageBodyResult({ content_completeness: "snippet_only", text: "a short preview", original_character_count: null })
  );
  assert.equal(result.content_completeness, "snippet_only");
  assert.equal(result.status_message, "Only a preview (Gmail snippet) is available");
});

test("buildReadGmailMessageResult — fetch_failed state is preserved, not upgraded", () => {
  const result = buildReadGmailMessageResult(
    "msg-5",
    fakeMessageBodyResult({ content_completeness: "fetch_failed", text: "", original_character_count: null })
  );
  assert.equal(result.content_completeness, "fetch_failed");
  assert.equal(result.status_message, "Message retrieval failed");
});

test("buildReadGmailMessageResult — locally_truncated survives independently of completeness", () => {
  const result = buildReadGmailMessageResult(
    "msg-6",
    fakeMessageBodyResult({ content_completeness: "full", locally_truncated: true })
  );
  assert.equal(result.content_completeness, "full");
  assert.equal(result.locally_truncated, true);
  assert.equal(result.status_message, "Full message retrieved, but locally truncated");
});

test("buildReadGmailMessageResult — attachment metadata is returned as-is, no content field present", () => {
  const result = buildReadGmailMessageResult(
    "msg-7",
    fakeMessageBodyResult({
      attachments: [{ filename: "invoice.pdf", mimeType: "application/pdf", size: 48213, attachmentId: "ATT_1" }],
    })
  );
  const attachments = result.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  assert.deepEqual(Object.keys(attachments[0]).sort(), ["attachmentId", "filename", "mimeType", "size"]);
  // No field on an attachment entry could ever hold downloaded file content —
  // the type itself (AttachmentMetadata) has no such field.
  assert.ok(!("content" in attachments[0]));
  assert.ok(!("data" in attachments[0]));
});

test("buildReadGmailMessageResult — never includes a token, snippet-source, or provider-error field", () => {
  const result = buildReadGmailMessageResult("msg-8", fakeMessageBodyResult());
  const keys = Object.keys(result);
  assert.deepEqual(
    keys.sort(),
    [
      "attachments",
      "content_completeness",
      "error_codes",
      "gmail_message_id",
      "locally_truncated",
      "original_character_count",
      "parts_failed",
      "status_message",
      "text",
    ].sort()
  );
});

// ── buildReadGmailMessageLogSummary — safe for console logs and tool_runs ────

test("buildReadGmailMessageLogSummary — raw body text never appears anywhere in the summary", () => {
  const full = buildReadGmailMessageResult(
    "msg-9",
    fakeMessageBodyResult({ text: "SECRET_BODY_TEXT_MARKER — a real deadline is April 1st, pay $9,000." })
  );
  const summary = buildReadGmailMessageLogSummary(full);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes("SECRET_BODY_TEXT_MARKER"));
  assert.ok(!serialized.includes("April 1st"));
  assert.ok(!serialized.includes("$9,000"));
  assert.ok(!("text" in summary));
});

test("buildReadGmailMessageLogSummary — retains only fixed, safe metadata fields", () => {
  const full = buildReadGmailMessageResult(
    "msg-10",
    fakeMessageBodyResult({
      content_completeness: "partial",
      locally_truncated: true,
      parts_failed: 1,
      original_character_count: 5000,
      error_codes: ["GMAIL_BASE64_DECODE_FAILED"],
      attachments: [{ filename: "case-notes.pdf", mimeType: "application/pdf", size: 1024, attachmentId: "A1" }],
    })
  );
  const summary = buildReadGmailMessageLogSummary(full);
  assert.deepEqual(summary, {
    tool: "read_gmail_message",
    gmail_message_id: "msg-10",
    content_completeness: "partial",
    locally_truncated: true,
    parts_failed: 1,
    original_character_count: 5000,
    attachment_count: 1,
    error_codes: ["GMAIL_BASE64_DECODE_FAILED"],
  });
});

test("buildReadGmailMessageLogSummary — attachment filenames never appear, only a count", () => {
  const full = buildReadGmailMessageResult(
    "msg-11",
    fakeMessageBodyResult({
      attachments: [
        { filename: "SSN_scan_confidential.pdf", mimeType: "application/pdf", size: 100, attachmentId: "A1" },
        { filename: "passport_photo.jpg", mimeType: "image/jpeg", size: 200, attachmentId: "A2" },
      ],
    })
  );
  const summary = buildReadGmailMessageLogSummary(full);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes("SSN_scan_confidential"));
  assert.ok(!serialized.includes("passport_photo"));
  assert.equal(summary.attachment_count, 2);
});

test("buildReadGmailMessageLogSummary — never spreads unknown/future fields from the raw result", () => {
  const full: Record<string, unknown> = {
    ...buildReadGmailMessageResult("msg-12", fakeMessageBodyResult()),
    some_future_field_with_content: "SHOULD_NEVER_LEAK",
  };
  const summary = buildReadGmailMessageLogSummary(full);
  assert.ok(!JSON.stringify(summary).includes("SHOULD_NEVER_LEAK"));
});
