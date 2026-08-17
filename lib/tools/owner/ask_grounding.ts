// Pure, dependency-free grounding/decision logic for the grounded question
// surface (app/api/owner/ask/route.ts, orchestrated by lib/ask.ts) — split
// out for the same reason as handle_email_grounding.ts: testable directly
// by Node's native test runner, without pulling in any @/-aliased runtime
// import chain. Nothing here performs I/O.
//
// NOTE ON DUPLICATION: the query-expansion SHAPE this surface needs (an LLM
// call that turns one input string into 6-8 search queries) is now the
// THIRD near-identical instance in this codebase — see generateSearchQueries
// in lib/tools/owner/handle_email.ts and generateQueries in
// lib/tools/owner/cross_reference.ts. Deliberately NOT extracted into a
// shared module in this phase — that would mean touching tested,
// working email/cross_reference code for a Phase-1 foundation, a bad trade.
// Worth extracting once a fourth caller shows up, or whenever someone is
// already touching all three at once.

import type { DocRef } from "./handle_email_grounding"; // type-only — erased at compile time, never resolved at runtime
import type { MemoryHit } from "@/lib/memory/retrieve"; // type-only — erased at compile time, never resolved at runtime

// ── Query construction ────────────────────────────────────────────────────────
// The raw question is ALWAYS included alongside whatever the LLM expansion
// step produces — deduplicated, never dropped. Expansion improves recall,
// but if the question itself already contains the exact identifier or
// phrase needed, that is the highest-precision query available and must
// never be crowded out by (or made dependent on) expansion succeeding.
export function buildAskQueries(question: string, generatedQueries: string[]): string[] {
  return [...new Set([question, ...generatedQueries])];
}

// ── Citations ──────────────────────────────────────────────────────────────────
// One unified, tagged citation list covering both retrieval corpora — a
// client renders these identically to how document/memory grounding is
// already cited in handle_email's proposal UI, just merged into one array.

export interface DocumentCitation {
  kind: "document";
  doc_id: string;
  title: string;
  page: number;
}

export interface MemoryCitation {
  kind: "memory";
  claim: string;
  source_kind: string;
  source_id: string;
}

export type Citation = DocumentCitation | MemoryCitation;

export function buildCitations(docs: DocRef[], memories: MemoryHit[]): Citation[] {
  const docCitations: DocumentCitation[] = docs.map((d) => ({
    kind: "document",
    doc_id: d.doc_id,
    title: d.title,
    page: d.page,
  }));
  const memoryCitations: MemoryCitation[] = memories.map((m) => ({
    kind: "memory",
    claim: m.claim,
    source_kind: m.source_kind,
    source_id: m.source_id,
  }));
  return [...docCitations, ...memoryCitations];
}

// ── Answer prompt ──────────────────────────────────────────────────────────────
// A SIBLING to buildDraftUserMessage (handle_email_grounding.ts) — not a
// modification of it. Email drafting must not change. Same "retrieve and
// cite, never conclude" discipline, adapted from "draft a reply" to "answer
// a question," with an explicit structured refusal path (grounded: false)
// instead of an invented [needs your input] placeholder — a question either
// gets answered from what's retrieved, or the system says plainly that its
// corpus doesn't cover it. No middle ground where it guesses.
export function buildAnswerUserMessage(question: string, groundingBlock: string): string {
  return `Answer a question for Caleb Ventura based strictly on retrieved excerpts below — documents and previously confirmed remembered facts.

${groundingBlock}

HARD RULES — each is a failure condition if violated:
1. Never state or imply any personal fact about Caleb — status, eligibility, identity, history, finances, account details, or any other fact — unless a retrieved excerpt above explicitly says it word for word.
2. Never infer facts from the question's wording, from what seems implied, or from general knowledge about the subject area.
3. If the retrieved excerpts do not contain enough to answer the question, set "grounded" to false and say plainly in "refusal_reason" what's missing — do NOT guess, hedge with a probable answer, or partially answer from unsupported inference. This is a normal, expected outcome, not a failure.
4. If you reference a document, name it exactly as it appears in the headings above and cite the page number. If you reference a remembered fact, quote it exactly as it appears.
5. Do not assert that Caleb "is" or "is not" any status, category, or classification — only quote what a retrieved excerpt says.
6. When describing what a document or remembered fact IS or says, use only the specific wording found in the excerpt — never a generic paraphrase that doesn't appear in the retrieved text.

Question: ${question}

Return JSON only, no markdown:
{"grounded": true|false, "answer": "<answer text, ONLY when grounded is true>", "refusal_reason": "<one sentence, ONLY when grounded is false — say plainly what's missing>"}`;
}

// ── Outcome classification ────────────────────────────────────────────────────
// Exactly three outcomes, deliberately never collapsed into two:
//   "answered" — a grounded answer, with citations.
//   "refused"  — the corpus doesn't cover this. This is a SUCCESS: the
//                system correctly recognized insufficient grounding and
//                stopped instead of guessing. Always shaped as a normal
//                200-level result by the caller, never as an error.
//   "error"    — the model produced no usable decision at all (unparseable
//                output, or a structurally invalid one). A genuine failure,
//                never conflated with a considered refusal.
export type AskOutcome =
  | { kind: "answered"; answer: string }
  | { kind: "refused"; reason: string }
  | { kind: "error"; message: string };

const DEFAULT_REFUSAL_REASON = "The retrieved documents and remembered facts don't cover this.";

export function classifyAskOutcome(rawModelText: string): AskOutcome {
  let parsed: { grounded?: unknown; answer?: unknown; refusal_reason?: unknown };
  try {
    const clean = rawModelText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    return { kind: "error", message: "Model returned unparseable output" };
  }

  if (parsed.grounded === true) {
    if (typeof parsed.answer === "string" && parsed.answer.trim()) {
      return { kind: "answered", answer: parsed.answer.trim() };
    }
    return { kind: "error", message: "Model reported grounded but supplied no answer" };
  }

  if (parsed.grounded === false) {
    const reason =
      typeof parsed.refusal_reason === "string" && parsed.refusal_reason.trim()
        ? parsed.refusal_reason.trim()
        : DEFAULT_REFUSAL_REASON;
    return { kind: "refused", reason };
  }

  return { kind: "error", message: "Model returned an unrecognized response shape" };
}
