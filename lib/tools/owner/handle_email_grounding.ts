// Pure, dependency-free grounding/safety logic for handle_email — split out
// specifically so it can be exercised directly by Node's native test runner
// without pulling in lib/documents.ts's heavy PDF/OCR runtime dependencies
// (pdf-parse, @napi-rs/canvas, tesseract.js) or lib/gmail.ts's @/-aliased
// import chain. Nothing in this file performs I/O; handle_email.ts imports
// these functions and supplies the actual search results / API responses.
//
// Origin: the Tennessee Tech housing incident. A housing-application email
// containing zero immigration content was drafted citing "I-360 Approval
// Notice - Caleb Tomas Ventura" as grounding and suggested it as an
// attachment, and separately invented a specific completion deadline the
// source email never stated (misreading unrelated refund/cancellation dates
// as the completion deadline). The functions below close both gaps.

import type { PageHit } from "@/lib/documents"; // type-only — erased at compile time, never resolved at runtime

// ── Document relevance selection ──────────────────────────────────────────────

export interface DocRef {
  doc_id: string;
  title: string;
  doc_type: string | null;
  page: number;
  snippet: string;
  highlight: string;
}

export type QueryOrigin = "fixed" | "llm";

export interface QueryResult {
  query: string;
  origin: QueryOrigin;
  hits: PageHit[];
}

// Below this ts_rank score, a hit is treated as noise regardless of source —
// a secondary floor. The primary defense is the LLM-query-corroboration
// requirement in selectRelevantDocuments below; this threshold alone would
// NOT have caught the housing incident, since an exact phrase match like
// "I-360" or "approval notice" against a document actually titled that way
// scores highly regardless of whether the email has anything to do with it.
export const MIN_RELEVANCE_SCORE = 0.01;

function cleanSnippet(raw: string): string {
  return raw.replace(/<\/?mark>/g, "").replace(/\s+/g, " ").trim();
}

function extractHighlight(raw: string): string {
  const spans: string[] = [];
  const re = /<mark>(.*?)<\/mark>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const s = m[1]?.trim();
    if (s) spans.push(s);
  }
  return spans.join(" ");
}

// A document is grounded in THIS email only when at least one query the LLM
// derived FROM the email's actual content (not a fixed, topic-agnostic query)
// found it. Fixed queries exist purely to reinforce/corroborate an
// email-derived match against OCR-imperfect indexed text (short, distinctive
// form-number tokens survive OCR corruption better than a full generated
// phrase) — they must never be sufficient BY THEMSELVES to introduce a
// document unconnected to what this specific email is about. "No source is
// better than an irrelevant source."
export function selectRelevantDocuments(
  results: QueryResult[],
  minScore: number = MIN_RELEVANCE_SCORE
): DocRef[] {
  const seenPages = new Map<string, { ref: DocRef; score: number; foundByLlmQuery: boolean }>();

  for (const { origin, hits } of results) {
    const isLlmQuery = origin === "llm";
    for (const h of hits) {
      const score = typeof h.score === "number" ? h.score : 0;
      if (score < minScore) continue;
      const pageKey = `${h.title}:${h.page_number}`;
      const existing = seenPages.get(pageKey);
      const foundByLlmQuery = (existing?.foundByLlmQuery ?? false) || isLlmQuery;
      if (!existing || score > existing.score) {
        seenPages.set(pageKey, {
          ref: {
            doc_id: h.doc_id ?? "",
            title: h.title,
            doc_type: h.doc_type ?? null,
            page: h.page_number,
            snippet: cleanSnippet(h.snippet),
            highlight: extractHighlight(h.snippet),
          },
          score,
          foundByLlmQuery,
        });
      } else {
        seenPages.set(pageKey, { ...existing, foundByLlmQuery });
      }
    }
  }

  // Drop any page never corroborated by an email-derived (LLM) query — a
  // fixed query alone is never sufficient grounding by itself.
  const corroborated = [...seenPages.values()].filter((p) => p.foundByLlmQuery);

  // Group by title — keep only the highest-scored page per document, so
  // every distinct relevant document appears once, ranked by its own best
  // match (mirrors the prior merge behavior for non-relevance reasons).
  const byTitle = new Map<string, { ref: DocRef; score: number }>();
  for (const { ref, score } of corroborated) {
    const existing = byTitle.get(ref.title);
    if (!existing || score > existing.score) byTitle.set(ref.title, { ref, score });
  }

  return Array.from(byTitle.values())
    .sort((a, b) => b.score - a.score)
    .map(({ ref }) => ref);
}

// ── Sensitive-document classification (deny-by-default for attachments) ──────
// doc_type is free-text, user-typed at upload time (see
// app/api/owner/documents/upload/route.ts) — not a structured/reliable
// category field — so classification is keyword-based against the title and
// (when present) doc_type, the same lexical-matching approach this codebase
// already relies on elsewhere (FIXED_QUERIES). Not exhaustive; deliberately
// biased toward over-flagging rather than under-flagging, since the failure
// mode this guards against is a sensitive document leaving the app as an
// unreviewed suggested attachment.
const SENSITIVE_DOCUMENT_KEYWORDS: readonly string[] = [
  // Immigration / legal status
  "i-797", "i-360", "i-765", "i-131", "i-485", "i-589", "i-821",
  "employment authorization", "ead", "green card", "permanent resident",
  "visa", "asylum", "immigration", "uscis", "deferred action",
  "special immigrant", "naturalization", "citizenship", "deportation",
  "removal proceedings", "approval notice",
  // Identity
  "passport", "social security", "ssn", "birth certificate",
  "driver's license", "drivers license", "national id",
  // Medical
  "medical record", "health record", "diagnosis", "prescription",
  "patient", "hipaa",
  // Financial
  "bank statement", "tax return", "w-2", "1099", "credit report",
  "pay stub", "financial statement",
  // Government (general, beyond immigration)
  "court order", "subpoena", "background check", "government id",
];

// Word-boundary matching, not plain substring — a raw .includes() would
// false-positive on short/generic keywords like "ead" (Employment
// Authorization Document) appearing inside ordinary words such as "already"
// or "Reading". \b works correctly even for multi-word/hyphenated keywords
// (e.g. "i-360", "employment authorization") since the boundary only needs
// to hold at the keyword's own start and end.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SENSITIVE_KEYWORD_PATTERN = new RegExp(
  `\\b(${SENSITIVE_DOCUMENT_KEYWORDS.map(escapeRegex).join("|")})\\b`,
  "i"
);

export function classifySensitiveDocument(title: string, docType: string | null): boolean {
  const haystack = `${title} ${docType ?? ""}`;
  return SENSITIVE_KEYWORD_PATTERN.test(haystack);
}

// Deterministic, keyword-based "does the email even mention this category"
// check — reuses the same sensitive-category vocabulary against the EMAIL
// TEXT rather than the document title. This is a heuristic, not true language
// understanding, but it directly closes the demonstrated failure: a housing
// email contains none of these terms, so no sensitive document can pass this
// gate no matter how high it scored in document search.
//
// Known limitation, stated plainly rather than silently assumed away: this
// tool has no visibility into whether the original email already carried the
// document as an attachment (handle_email's input schema doesn't receive the
// source message's own attachment list), so "the user has not already
// supplied it through the requested channel" cannot be verified here. This
// function only answers "does the email's text mention this category" — a
// necessary but not sufficient condition for suggesting a sensitive-document
// attachment.
export function emailExplicitlyMentionsSensitiveCategory(emailText: string): boolean {
  return SENSITIVE_KEYWORD_PATTERN.test(emailText);
}

// ── Draft prompt: deadline discipline + no-invented-placeholder hard rules ──
// Kept as their own constants (rather than inline in the prompt template) so
// their exact wording is directly testable without a live model call — see
// lib/tools/owner/handle_email_grounding.test.ts.

export const DEADLINE_DISCIPLINE_RULES = `7. Deadline discipline: if the email asks for an action but does not attach an explicit date to that specific action (e.g. it says "as soon as possible," "at your earliest convenience," or gives no date at all), do not invent or imply a specific deadline for that action — state plainly that no deadline was given for it.
8. A date may be presented as the deadline for a specific required action ONLY when the email's own text explicitly and directly connects that date to that action (e.g. "complete your application by May 1"). A date attached to a different purpose in the same email — cancellation, refunds, unrelated events — must be labeled for what it actually is and explicitly stated to NOT be the deadline for the requested action. Never present an unrelated date as if it were the action's deadline.`;

export const NO_INVENTED_PLACEHOLDER_RULE = `9. Do not invent a question, uncertainty, or open item the email itself doesn't raise. If the email's request and the required action are already clear from its own text, state them directly — do not manufacture a placeholder, a request for clarification, or an unresolved question just to seem thorough. (Separate from rule 3, which covers facts ABOUT THE USER missing from retrieved documents — that placeholder still applies to those gaps.)`;

// ── Draft prompt construction (pure — no network access) ─────────────────────

export function buildGroundingBlock(docs: DocRef[]): string {
  return docs.length > 0
    ? `RETRIEVED DOCUMENT EXCERPTS — the ONLY facts you may assert about the user:

${docs.map((d) => `[${d.title} · p.${d.page}]\n"${d.snippet}"`).join("\n\n")}`
    : "No matching documents were found. Do not assert any facts about the user.";
}

export function buildDraftUserMessage(
  emailText: string,
  sender: string,
  subject: string,
  groundingBlock: string
): string {
  return `Draft a reply email for Caleb Ventura based strictly on retrieved document excerpts.

${groundingBlock}

HARD RULES — each is a failure condition if violated:
1. Never state or imply the user's citizenship, immigration status, eligibility, or any personal legal fact unless a retrieved excerpt above explicitly says it word for word.
2. Never infer facts from the email's wording, from what the sender seems to assume, or from general knowledge about immigration law.
3. If the email asks about a fact not present in the retrieved excerpts, write [needs your input: describe what's missing] as a placeholder rather than guessing.
4. If you reference a document, name it exactly as it appears in the headings above and cite the page number.
5. Do not assert that the user "is" or "is not" a citizen, permanent resident, or any status — only quote what the document says.
6. When describing what a document IS, use only the specific form name, type, and classification found in its retrieved excerpt — e.g. "Special Immigrant Juvenile" if the excerpt says that, or "category C14" if the excerpt says that. Never use generic phrases like "approval of a nonimmigrant petition" that don't appear in the retrieved text.
${DEADLINE_DISCIPLINE_RULES}
${NO_INVENTED_PLACEHOLDER_RULE}

Voice: Caleb's casual, lowercase, direct style. Short sentences. If a document is relevant, say you're attaching it and name it exactly.

Email to reply to:
From: ${sender || "(unknown)"}
Subject: ${subject || "(no subject)"}
Body:
${emailText}

Write only the reply body — no greeting header, no subject line, no sign-off.`;
}
