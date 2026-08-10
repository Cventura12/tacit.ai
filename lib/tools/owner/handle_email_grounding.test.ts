import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  selectRelevantDocuments,
  classifySensitiveDocument,
  emailExplicitlyMentionsSensitiveCategory,
  buildGroundingBlock,
  buildDraftUserMessage,
  buildTriageUserMessage,
  DEADLINE_DISCIPLINE_RULES,
  NO_INVENTED_PLACEHOLDER_RULE,
  MIN_RELEVANCE_SCORE,
  type QueryResult,
  type DocRef,
} from "./handle_email_grounding.ts";

// ── Fixture: the exact Tennessee Tech housing email structure from the ────────
//    incident report — used across the deadline-discipline and
//    grounding-relevance regression tests below.

const HOUSING_EMAIL_TEXT = `Dear Caleb,

Thank you for starting your housing application with Tennessee Tech University Housing and Residential Life. Our records show your application is not yet complete. Please log into the housing portal and complete your application as soon as possible so we can process your assignment.

For your reference, our cancellation and refund policy deadlines are as follows:
- Fall/Spring Contracts: May 1
- Spring Only Contracts: December 1
- Summer Contracts: May 1

If you have already submitted your application, please disregard this message.

Tennessee Tech Housing & Residential Life`;

function fakeHit(overrides: Partial<{
  doc_id: string;
  title: string;
  doc_type: string | null;
  page_number: number;
  snippet: string;
  score: number;
}> = {}) {
  return {
    doc_id: "doc-1",
    title: "Some Document",
    doc_type: null,
    page_number: 1,
    snippet: "some <mark>matched</mark> text",
    score: 0.5,
    ...overrides,
  };
}

// ── selectRelevantDocuments ────────────────────────────────────────────────────

test("selectRelevantDocuments — a document found ONLY via a fixed query is rejected (Tennessee Tech housing incident)", () => {
  const results: QueryResult[] = [
    {
      query: "I-360",
      origin: "fixed",
      hits: [fakeHit({ title: "I-360 Approval Notice - Caleb Tomas Ventura", score: 0.9 })],
    },
    {
      query: "approval notice",
      origin: "fixed",
      hits: [fakeHit({ title: "I-360 Approval Notice - Caleb Tomas Ventura", score: 0.7 })],
    },
  ];
  const docs = selectRelevantDocuments(results);
  assert.deepEqual(docs, [], "a document found only by fixed (topic-agnostic) queries must never be grounding");
});

test("selectRelevantDocuments — a document found by an LLM-generated (email-derived) query is accepted", () => {
  const results: QueryResult[] = [
    {
      query: "student housing application",
      origin: "llm",
      hits: [fakeHit({ title: "Tennessee Tech Housing Guide", score: 0.6 })],
    },
  ];
  const docs = selectRelevantDocuments(results);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, "Tennessee Tech Housing Guide");
});

test("selectRelevantDocuments — a document found by BOTH a fixed and an LLM query is accepted (corroborated)", () => {
  const results: QueryResult[] = [
    { query: "I-360", origin: "fixed", hits: [fakeHit({ title: "I-360 Approval Notice", score: 0.4 })] },
    {
      query: "special immigrant juvenile status update",
      origin: "llm",
      hits: [fakeHit({ title: "I-360 Approval Notice", score: 0.3 })],
    },
  ];
  const docs = selectRelevantDocuments(results);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, "I-360 Approval Notice");
  // The higher of the two scores wins for ranking, regardless of which origin produced it.
  assert.equal(docs[0].snippet, "some matched text");
});

test("selectRelevantDocuments — a below-threshold score is excluded even from an LLM-origin query", () => {
  const results: QueryResult[] = [
    { query: "housing", origin: "llm", hits: [fakeHit({ title: "Weak Match Doc", score: MIN_RELEVANCE_SCORE / 2 })] },
  ];
  const docs = selectRelevantDocuments(results);
  assert.deepEqual(docs, []);
});

test("selectRelevantDocuments — a score exactly at the threshold is included", () => {
  const results: QueryResult[] = [
    { query: "housing", origin: "llm", hits: [fakeHit({ title: "Borderline Doc", score: MIN_RELEVANCE_SCORE })] },
  ];
  const docs = selectRelevantDocuments(results);
  assert.equal(docs.length, 1);
});

test("selectRelevantDocuments — zero relevant documents produces zero grounded sources", () => {
  const results: QueryResult[] = [
    { query: "I-797", origin: "fixed", hits: [fakeHit({ title: "Doc A", score: 0.8 })] },
    { query: "I-360", origin: "fixed", hits: [fakeHit({ title: "Doc B", score: 0.6 })] },
    { query: "employment authorization", origin: "fixed", hits: [] },
  ];
  const docs = selectRelevantDocuments(results);
  assert.deepEqual(docs, [], "no source is better than an irrelevant source");
});

test("selectRelevantDocuments — dedups by title, keeping the highest score across multiple LLM-origin pages", () => {
  const results: QueryResult[] = [
    {
      query: "housing deadlines",
      origin: "llm",
      hits: [
        fakeHit({ title: "Housing Guide", page_number: 1, score: 0.2 }),
        fakeHit({ title: "Housing Guide", page_number: 2, score: 0.5 }),
      ],
    },
  ];
  const docs = selectRelevantDocuments(results);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].page, 2);
});

test("selectRelevantDocuments — carries doc_type through for downstream sensitivity classification", () => {
  const results: QueryResult[] = [
    {
      query: "housing",
      origin: "llm",
      hits: [fakeHit({ title: "Housing Guide", doc_type: "housing" })],
    },
  ];
  const docs = selectRelevantDocuments(results);
  assert.equal(docs[0].doc_type, "housing");
});

// ── classifySensitiveDocument ──────────────────────────────────────────────────

test("classifySensitiveDocument — an I-360 approval notice is classified sensitive", () => {
  assert.equal(classifySensitiveDocument("I-360 Approval Notice - Caleb Tomas Ventura", null), true);
});

test("classifySensitiveDocument — an unrelated housing document is not classified sensitive", () => {
  assert.equal(classifySensitiveDocument("Tennessee Tech Housing Guide", null), false);
  assert.equal(classifySensitiveDocument("Student Housing Application Confirmation", "housing"), false);
});

test("classifySensitiveDocument — case-insensitive", () => {
  assert.equal(classifySensitiveDocument("i-360 approval notice", null), true);
});

test("classifySensitiveDocument — covers medical, financial, and identity categories", () => {
  assert.equal(classifySensitiveDocument("2024 Medical Record Summary", null), true);
  assert.equal(classifySensitiveDocument("Bank Statement - March", null), true);
  assert.equal(classifySensitiveDocument("Passport Scan", null), true);
  assert.equal(classifySensitiveDocument("Reading List", null), false);
});

test("classifySensitiveDocument — also checks doc_type when title alone doesn't reveal the category", () => {
  assert.equal(classifySensitiveDocument("Scan 004", "tax return"), true);
  assert.equal(classifySensitiveDocument("Scan 004", "receipt"), false);
});

// ── emailExplicitlyMentionsSensitiveCategory ──────────────────────────────────

test("emailExplicitlyMentionsSensitiveCategory — the exact housing email never mentions a sensitive category", () => {
  assert.equal(emailExplicitlyMentionsSensitiveCategory(HOUSING_EMAIL_TEXT), false);
});

test("emailExplicitlyMentionsSensitiveCategory — an email that actually discusses immigration status returns true", () => {
  assert.equal(
    emailExplicitlyMentionsSensitiveCategory("Please send your employment authorization document for verification."),
    true
  );
});

// ── Sensitive-document attachment gate (integration of the two functions above) ─

test("unrelated sensitive document is never suggested as an attachment for the housing email", () => {
  const i360: DocRef = {
    doc_id: "doc-i360",
    title: "I-360 Approval Notice - Caleb Tomas Ventura",
    doc_type: null,
    page: 1,
    snippet: "approval notice text",
    highlight: "",
  };
  const sensitive = classifySensitiveDocument(i360.title, i360.doc_type);
  const mentioned = emailExplicitlyMentionsSensitiveCategory(HOUSING_EMAIL_TEXT);
  const allowedAsAttachment = !sensitive || mentioned;
  assert.equal(sensitive, true);
  assert.equal(mentioned, false);
  assert.equal(allowedAsAttachment, false, "a sensitive document must be excluded from suggested attachments when the email never mentions that category");
});

// ── buildGroundingBlock ────────────────────────────────────────────────────────

test("buildGroundingBlock — zero documents: explicit 'no matching documents' text, never a fabricated citation", () => {
  const block = buildGroundingBlock([]);
  assert.equal(block, "No matching documents were found. Do not assert any facts about the user.");
});

test("buildGroundingBlock — non-empty documents: includes title, page, and snippet", () => {
  const block = buildGroundingBlock([
    { doc_id: "1", title: "Housing Guide", doc_type: null, page: 3, snippet: "some excerpt", highlight: "" },
  ]);
  assert.ok(block.includes("Housing Guide"));
  assert.ok(block.includes("p.3"));
  assert.ok(block.includes("some excerpt"));
});

// ── buildDraftUserMessage — deadline discipline (exact housing email structure) ─

test("buildDraftUserMessage — the exact housing email text passes through verbatim", () => {
  const prompt = buildDraftUserMessage(HOUSING_EMAIL_TEXT, "housing@tntech.edu", "Complete Your Housing Application", buildGroundingBlock([]));
  assert.ok(prompt.includes(HOUSING_EMAIL_TEXT));
});

test("buildDraftUserMessage — instructs the model never to convert 'as soon as possible' into a specific deadline", () => {
  const prompt = buildDraftUserMessage(HOUSING_EMAIL_TEXT, "", "", buildGroundingBlock([]));
  assert.match(prompt, /as soon as possible/i);
  assert.match(prompt, /do not invent or imply a specific deadline/i);
});

test("buildDraftUserMessage — instructs the model to distinguish completion deadlines from cancellation/refund deadlines", () => {
  const prompt = buildDraftUserMessage(HOUSING_EMAIL_TEXT, "", "", buildGroundingBlock([]));
  assert.match(prompt, /cancellation, refunds, unrelated events/i);
  assert.match(prompt, /must be labeled for what it actually is/i);
  assert.match(prompt, /explicitly stated to NOT be the deadline/i);
});

test("buildDraftUserMessage — requires an explicit textual connection before labeling a date as THE deadline", () => {
  const prompt = buildDraftUserMessage(HOUSING_EMAIL_TEXT, "", "", buildGroundingBlock([]));
  assert.match(prompt, /explicitly and directly connects that date to that action/i);
});

test("buildDraftUserMessage — instructs the model not to invent a question/placeholder the email doesn't raise", () => {
  const prompt = buildDraftUserMessage(HOUSING_EMAIL_TEXT, "", "", buildGroundingBlock([]));
  assert.match(prompt, /do not invent a question, uncertainty, or open item/i);
  assert.match(prompt, /do not manufacture a placeholder/i);
});

test("buildDraftUserMessage — deadline-discipline and no-placeholder rules are numbered after the original six, never replacing them", () => {
  const prompt = buildDraftUserMessage(HOUSING_EMAIL_TEXT, "", "", buildGroundingBlock([]));
  assert.match(prompt, /1\. Never state or imply the user's citizenship/);
  assert.match(prompt, /6\. When describing what a document IS/);
  assert.ok(prompt.includes(DEADLINE_DISCIPLINE_RULES));
  assert.ok(prompt.includes(NO_INVENTED_PLACEHOLDER_RULE));
  const idx6 = prompt.indexOf("6. When describing");
  const idx7 = prompt.indexOf(DEADLINE_DISCIPLINE_RULES);
  const idx9 = prompt.indexOf(NO_INVENTED_PLACEHOLDER_RULE);
  assert.ok(idx6 < idx7 && idx7 < idx9);
});

test("buildDraftUserMessage — zero-document grounding block still reaches the model, so the email itself is the primary factual source", () => {
  const prompt = buildDraftUserMessage(HOUSING_EMAIL_TEXT, "", "", buildGroundingBlock([]));
  assert.ok(prompt.includes("No matching documents were found. Do not assert any facts about the user."));
  assert.ok(prompt.includes(HOUSING_EMAIL_TEXT), "the email body is still supplied as the source to draft from");
});

// ── buildTriageUserMessage — reply-required vs. action-required ──────────────
// Origin: the exact Tennessee Tech housing email was classified "ignore" with
// reasoning "nobody is waiting on a reply" / "nothing actionable is being
// asked." The prior prompt classified "ignore" for any "fully automated
// no-reply notification (no human waiting on a response)" — conflating
// reply-required with action-required, which are independent questions.

test("buildTriageUserMessage — the exact housing email text passes through verbatim", () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "housing@tntech.edu", "Complete Your Housing Application", 1200);
  assert.ok(prompt.includes(HOUSING_EMAIL_TEXT.slice(0, 1200)));
});

test("buildTriageUserMessage — automated sender does not imply ignore", () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "", "", 1200);
  assert.match(prompt, /"Automated" does NOT mean "ignore\."/);
  assert.match(prompt, /the sender is automated or no-reply/i);
});

test("buildTriageUserMessage — no reply expected does not imply no action", () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "", "", 1200);
  assert.match(prompt, /"No reply required" does NOT mean "no action required\."/);
  assert.match(prompt, /no human is waiting on a reply/i);
});

test('buildTriageUserMessage — "please complete your application" is explicitly never ignore', () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "", "", 1200);
  assert.match(prompt, /An explicit instruction such as "please complete your application" is NEVER "ignore"/);
  assert.match(prompt, /That is "actionable" with reply_required:false/);
});

test("buildTriageUserMessage — portal-based action is explicitly preserved as a valid required action", () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "", "", 1200);
  assert.match(prompt, /logging into a portal/i);
  assert.match(prompt, /the required action happens through a portal, website, payment page, or in person/i);
});

test("buildTriageUserMessage — absence of a specific deadline does not remove actionability", () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "", "", 1200);
  assert.match(prompt, /no exact deadline is given/i);
});

test("buildTriageUserMessage — reply_required is asked for as an output field, independent of classification", () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "", "", 1200);
  assert.match(prompt, /"reply_required":true\|false/);
  assert.match(prompt, /Set reply_required to false when the real required action happens somewhere else/i);
});

test("buildTriageUserMessage — the tightened ignore criteria require ALL conditions, not any one", () => {
  const prompt = buildTriageUserMessage(HOUSING_EMAIL_TEXT, "", "", 1200);
  assert.match(prompt, /Classify as "ignore" ONLY when ALL of the following hold/);
  assert.match(prompt, /No action is requested or implied/i);
  assert.match(prompt, /No meaningful decision is presented/i);
  assert.match(prompt, /No deadline, requirement, risk, or follow-up is mentioned/i);
  assert.match(prompt, /purely informational or promotional/i);
});

// ── Static checks: handle_email.ts actually wires these functions in ─────────
// handle_email.ts itself can't be imported directly by Node's test runner (it
// pulls in @/lib/gmail and @/lib/documents, which resolve only under Next.js's
// bundler) — these are source-text checks proving the wiring is correct, the
// same established pattern used elsewhere in this codebase for files with the
// same constraint (see lib/tools/owner/read_gmail.test.ts).

const HERE = dirname(fileURLToPath(import.meta.url));

function readHandleEmailSource(): string {
  return readFileSync(resolve(HERE, "handle_email.ts"), "utf-8");
}

test("handle_email.ts — gatherDocuments delegates relevance filtering to selectRelevantDocuments", () => {
  const source = readHandleEmailSource();
  assert.match(source, /const merged = selectRelevantDocuments\(perQueryResults\)/);
  assert.match(source, /origin: "llm"|origin = llmQuerySet\.has\(q\)/);
});

test("handle_email.ts — suggested_attachments is gated by classifySensitiveDocument + emailExplicitlyMentionsSensitiveCategory", () => {
  const source = readHandleEmailSource();
  assert.match(source, /const emailMentionsSensitiveCategory = emailExplicitlyMentionsSensitiveCategory\(emailText\)/);
  assert.match(source, /classifySensitiveDocument\(d\.title, d\.doc_type\)/);
  const gateIdx = source.indexOf("let attachmentCandidates: DocRef[] = [];");
  const suggestedIdx = source.indexOf("suggested_attachments: attachmentCandidates.map");
  const attachmentIdsIdx = source.indexOf("attachment_doc_ids: attachmentCandidates.map");
  assert.ok(gateIdx > 0 && suggestedIdx > gateIdx && attachmentIdsIdx > gateIdx);
});

test("handle_email.ts — matched_documents (citations) are NOT filtered by the sensitivity gate, only suggested_attachments is", () => {
  const source = readHandleEmailSource();
  assert.match(source, /matched_documents: dedupedDocs,/);
});

test("handle_email.ts — draftEmailReply uses buildGroundingBlock and buildDraftUserMessage rather than an inline template", () => {
  const source = readHandleEmailSource();
  assert.match(source, /const groundingBlock = buildGroundingBlock\(docs\)/);
  assert.match(source, /content: buildDraftUserMessage\(emailText, sender, subject, groundingBlock\)/);
});

test("EmailProposalCard.tsx — safety-check text is conditional on sourceCount, never claims a citation when there are zero sources", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  assert.match(source, /sourceCount > 0\s*\n\s*\? "Every claim traces to a cited page\."\s*\n\s*: "Grounded in the retrieved email/);
});

// ── Static checks: reply-required vs. action-required wiring ─────────────────

test("handle_email.ts — triageEmail uses buildTriageUserMessage rather than an inline template", () => {
  const source = readHandleEmailSource();
  assert.match(source, /content: buildTriageUserMessage\(emailText, sender, subject, TRIAGE_TEXT_CAP\)/);
});

test("handle_email.ts — triage response parsing reads reply_required, defaulting to true (never silently skips a needed reply)", () => {
  const source = readHandleEmailSource();
  assert.match(source, /reply_required\?: unknown/);
  assert.match(source, /typeof parsed\.reply_required === "boolean" \? parsed\.reply_required : true/);
});

test("handle_email.ts — action grounding (document search) runs for every actionable email, independent of replyRequired", () => {
  const source = readHandleEmailSource();
  const gatherIdx = source.indexOf("matchedDocs = await gatherDocuments(llmQueries)");
  assert.ok(gatherIdx > 0);
  // The nearest enclosing `if` before gatherDocuments must gate on
  // classification alone — NOT on replyRequired — so grounding is never
  // silently starved for a non-reply action that still needs it.
  const before = source.slice(0, gatherIdx);
  const lastIf = before.lastIndexOf('if (classification === "actionable")');
  const lastIfWithReply = before.lastIndexOf('if (classification === "actionable" && replyRequired)');
  assert.ok(lastIf > 0, "gatherDocuments must be reached via an actionable-only gate");
  assert.equal(lastIfWithReply, -1, "gatherDocuments must not be additionally gated on replyRequired");
});

test("handle_email.ts — reply drafting is gated on replyRequired specifically, nested separately from the grounding gate", () => {
  const source = readHandleEmailSource();
  const draftIdx = source.indexOf("draftReply = await draftEmailReply(");
  assert.ok(draftIdx > 0);
  const before = source.slice(0, draftIdx);
  assert.ok(before.lastIndexOf("if (replyRequired)") > before.lastIndexOf("gatherDocuments"));
});

test("handle_email.ts — suggested attachments are empty by default and only populated when replyRequired is true", () => {
  const source = readHandleEmailSource();
  assert.match(source, /let attachmentCandidates: DocRef\[\] = \[\];/);
  assert.match(source, /if \(replyRequired\) \{\s*\n\s*const emailMentionsSensitiveCategory/);
});

test("handle_email.ts — reply_required is carried onto the returned proposal", () => {
  const source = readHandleEmailSource();
  assert.match(source, /reply_required: replyRequired,/);
});

test("lib/types.ts — EmailProposal declares reply_required as boolean | null (null reserved for legacy stored rows)", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "lib", "types.ts"), "utf-8");
  assert.match(source, /reply_required: boolean \| null;/);
});

test("EmailProposalCard.tsx — sourceCount is computed via the defensive countGenuineSources helper, not a raw .length", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  assert.match(source, /import \{ countGenuineSources \} from "@\/lib\/email-proposal"/);
  assert.match(source, /const sourceCount = countGenuineSources\(proposal\.matched_documents\)/);
  assert.ok(!source.includes("proposal.matched_documents.length"), "must not fall back to an unguarded .length read");
});

test("EmailProposalCard.tsx — the 'Approve draft' send button is only shown when a draft actually exists", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  const footerIdx = source.indexOf("{/* ── Footer ── */}");
  const footer = source.slice(footerIdx, footerIdx + 900);
  assert.match(footer, /\{hasDraft && \(/);
  assert.match(footer, /Approve draft/);
});

test("EmailProposalCard.tsx — a 'No reply needed' indicator is shown for actionable proposals with reply_required false", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  assert.match(source, /const replyOptional = proposal\.classification === "actionable" && proposal\.reply_required === false/);
  assert.match(source, /NO REPLY NEEDED/);
});

// ── Persistence: DB write path, DB read path, legacy/null UI handling ────────
// Origin: reply_required now persists via migrations-12-pending-proposals-
// reply-required.sql (nullable, no DEFAULT, no backfill). These prove the
// write path never fabricates true/false, the read path never coerces a
// legacy null, and the UI never states a false certainty for null.

test("lib/db.ts — pending_proposals Row/Insert declare reply_required as nullable, no non-null assumption", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "lib", "db.ts"), "utf-8");
  assert.match(source, /reply_required: boolean \| null;/);
  assert.match(source, /reply_required\?: boolean \| null;/);
});

test("lib/inbox-watch.ts — writes reply_required via resolveReplyRequiredForInsert, never a raw boolean coercion", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "lib", "inbox-watch.ts"), "utf-8");
  assert.match(source, /import \{ resolveReplyRequiredForInsert \} from "@\/lib\/email-proposal"/);
  assert.match(source, /reply_required: resolveReplyRequiredForInsert\(proposal\.reply_required\),/);
});

test("app/inbox/view.tsx — reply_required is read through unchanged from the stored row, never forced to true", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "app", "inbox", "view.tsx"), "utf-8");
  assert.match(source, /reply_required: boolean \| null;/);
  assert.match(source, /reply_required: p\.reply_required,/);
  assert.ok(!source.includes("reply_required: true"), "must never hardcode true for a stored row");
});

test("EmailProposalCard.tsx — a null reply_required is labeled unknown/legacy, never asserted as required or not required", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  assert.match(source, /const replyUnknown = proposal\.classification === "actionable" && proposal\.reply_required === null/);
  assert.match(source, /reply requirement unknown/i);
  // The badge/approval-control gating must be driven by hasDraft, not by the
  // tri-state reply_required value directly — a null must never suppress or
  // manufacture controls on its own.
  assert.match(source, /const hasDraft = proposal\.draft_reply !== null;/);
});

test("EmailProposalCard.tsx — suggested attachments are only shown alongside an actual draft", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  assert.match(source, /\{hasDraft && proposal\.suggested_attachments\.length > 0 && \(/);
});

// ── Remaining gaps against the full regression checklist ──────────────────────

test("handle_email.ts — classification is a const destructured directly from triage and passed through unchanged (never rewritten to 'ignore' because replyRequired is false)", () => {
  const source = readHandleEmailSource();
  assert.match(
    source,
    /const \{ classification, reason, replyRequired \} = await triageEmail\(/,
    "classification must be const-bound from triage — structurally not reassignable before it reaches the proposal"
  );
  assert.match(
    source,
    /const proposal: EmailProposal = \{\s*\n\s*classification,\s*\n\s*reason,\s*\n\s*reply_required: replyRequired,/,
    "the proposal must carry the exact triage classification unchanged, alongside the independently-determined reply_required"
  );
});

test("handle_email.ts — replyRequired true reaches draftEmailReply, preserving the normal draft workflow", () => {
  const source = readHandleEmailSource();
  const ifIdx = source.indexOf("if (replyRequired) {");
  assert.ok(ifIdx > 0);
  const draftIdx = source.indexOf("draftReply = await draftEmailReply(", ifIdx);
  assert.ok(draftIdx > ifIdx, "draftEmailReply must be reachable inside the replyRequired-true branch");
});

test("lib/inbox-watch.ts — the storage skip is gated on classification === 'ignore' only, never on reply_required (an actionable, no-reply-needed proposal is still stored)", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "inbox-watch.ts"), "utf-8");
  const skipIdx = source.indexOf('proposal.classification === "ignore"');
  assert.ok(skipIdx > 0, "expected an ignore-classification skip check");
  const lineStart = source.lastIndexOf("\n", skipIdx) + 1;
  const lineEnd = source.indexOf("\n", skipIdx);
  const skipLine = source.slice(lineStart, lineEnd);
  assert.ok(
    !skipLine.includes("reply_required"),
    "the skip condition must not also check reply_required — actionable + reply_required:false must still be persisted, not silently dropped"
  );
});

test("EmailProposalCard.tsx — the no-reply state names the external action explicitly (a portal), keeping it visible instead of just labeling 'no reply'", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  assert.ok(
    source.includes(
      "No reply required — the action above happens outside email (e.g. a portal), so no draft was prepared."
    )
  );
});

test("EmailProposalCard.tsx — draft approval controls are gated on hasDraft alone, never additionally restricted by reply_required (a legacy row with a real draft stays usable)", () => {
  const source = readFileSync(resolve(HERE, "..", "..", "..", "components", "EmailProposalCard.tsx"), "utf-8");
  const footerIdx = source.indexOf("{/* ── Footer ── */}");
  const footer = source.slice(footerIdx, footerIdx + 900);
  assert.match(footer, /\{hasDraft && \(/, "Approve draft controls must be gated on hasDraft");
  assert.ok(
    !footer.includes("hasDraft && !replyOptional") && !footer.includes("hasDraft && !replyUnknown"),
    "must not layer an extra reply_required-based restriction on top of hasDraft — a legacy row with a real draft must stay approvable"
  );
});
