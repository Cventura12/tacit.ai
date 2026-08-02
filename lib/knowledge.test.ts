import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_SYSTEM_PROMPT_EXTENSION } from "./knowledge.ts";

// These are prompt-content checks, not behavioral proof — the model's actual
// tool-call sequencing can't be unit tested without a live API call. What IS
// verifiable here: the explicit sequencing rule exists, read_gmail_message is
// named as a required step before handle_email, and the prompt tells the
// model not to treat a listing snippet as the complete email. The structural
// backstop is resolveTrustedEmailContent (lib/gmail.ts): when a trusted cache
// entry exists for the referenced gmail_message_id, it overrides the model's
// own email_text with the exact retrieved text, not just the completeness
// label — so even a model that ignores this prompt text and supplies altered,
// truncated, or prompt-injected email_text still gets handled using the real
// fetched content. On a cache miss, provenance degrades to "unknown" rather
// than being fabricated. See lib/gmail.test.ts's resolveTrustedEmailContent
// tests for both guarantees.

test("OWNER_SYSTEM_PROMPT_EXTENSION — read_gmail_message is required before substantive analysis or handle_email", () => {
  const emailSection = OWNER_SYSTEM_PROMPT_EXTENSION.slice(
    OWNER_SYSTEM_PROMPT_EXTENSION.indexOf("Email handling")
  );
  assert.match(emailSection, /read_gmail_message/);
  assert.match(emailSection, /read_gmail to find candidate messages/i);

  // read_gmail_message must be sequenced BEFORE handle_email in the text.
  const readMessageIdx = emailSection.indexOf("read_gmail_message");
  const handleEmailIdx = emailSection.indexOf("handle_email only with");
  assert.ok(readMessageIdx >= 0 && handleEmailIdx >= 0);
  assert.ok(readMessageIdx < handleEmailIdx, "read_gmail_message must be introduced before the handle_email rule");
});

test("OWNER_SYSTEM_PROMPT_EXTENSION — explicitly forbids treating a listing snippet as the complete email", () => {
  const emailSection = OWNER_SYSTEM_PROMPT_EXTENSION.slice(
    OWNER_SYSTEM_PROMPT_EXTENSION.indexOf("Email handling")
  );
  assert.match(emailSection, /never (say or imply that a )?read_gmail (listing )?snippet is the complete email/i);
});

test("OWNER_SYSTEM_PROMPT_EXTENSION — pasted text is never claimed to be the complete original message", () => {
  const emailSection = OWNER_SYSTEM_PROMPT_EXTENSION.slice(
    OWNER_SYSTEM_PROMPT_EXTENSION.indexOf("Email handling")
  );
  assert.match(emailSection, /pasted/i);
  assert.match(emailSection, /don't claim it's the entire original message/i);
});

test("OWNER_SYSTEM_PROMPT_EXTENSION — references content_completeness before summarizing", () => {
  const emailSection = OWNER_SYSTEM_PROMPT_EXTENSION.slice(
    OWNER_SYSTEM_PROMPT_EXTENSION.indexOf("Email handling")
  );
  assert.match(emailSection, /content_completeness/);
});
