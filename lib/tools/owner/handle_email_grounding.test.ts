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
  const gateIdx = source.indexOf("const attachmentCandidates = dedupedDocs.filter");
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
