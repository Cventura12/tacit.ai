// Grounded question-answering — the question surface, Phase 1 of Tacit's
// shift from "email handler" to "founder's sparring partner" (see
// app/api/owner/ask/route.ts for the full framing). Builds on the SAME
// retrieve→ground→answer pattern already proven in
// lib/tools/owner/handle_email.ts and lib/tools/owner/cross_reference.ts —
// deliberately NOT the outer agent loop (app/api/chat/route.ts's
// runAgentLoop), which exposes all 18 registry tools to free model choice
// and streams SSE. A question must never be able to trigger a
// side-effecting tool like toggle_connector; this module never gives the
// model a tool-call surface at all — only a fixed, auditable
// retrieve-then-answer shape, and JSON in/out rather than a stream.
//
// RETRIEVAL FAILURES PROPAGATE. Unlike handle_email's gatherDocuments (which
// swallows a single query's search error so one bad query doesn't sink an
// otherwise-working draft), both document and memory retrieval here are
// REQUIRED, non-optional parts of this surface's contract — so a genuine
// failure in either is allowed to throw and propagate to the caller as a
// real error, never silently degrading to an ungrounded (or falsely
// "refused") answer. Query EXPANSION is the one exception — see
// generateAskQueries below — because the raw question is always searched
// regardless (see buildAskQueries), so expansion failing is not a retrieval
// failure, just a smaller query set.

import Anthropic from "@anthropic-ai/sdk";
import { search } from "@/lib/documents";
import { searchMemories, type MemoryHit } from "@/lib/memory/retrieve";
import {
  buildGroundingBlock,
  buildMemoryGroundingBlock,
  type DocRef,
} from "@/lib/tools/owner/handle_email_grounding";
import {
  buildAskQueries,
  buildCitations,
  buildAnswerUserMessage,
  classifyAskOutcome,
  type Citation,
  type AskOutcome,
} from "@/lib/tools/owner/ask_grounding";

const DOC_RESULTS_PER_QUERY = 8;
const MEMORY_RESULTS_PER_QUERY = 5;
const MAX_MEMORIES = 5;

const CLIENT = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Same shape as generateSearchQueries (handle_email.ts) and generateQueries
// (cross_reference.ts) — see ask_grounding.ts's header on the resulting
// three-way duplication, deliberately not extracted in this phase.
//
// Failures here are swallowed, not propagated: buildAskQueries always
// includes the raw question regardless of what this returns, so expansion
// breaking entirely still leaves a valid (if narrower) search — never a
// blocked request.
async function generateAskQueries(question: string): Promise<string[]> {
  let text = "";
  try {
    const res = await CLIENT.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      messages: [
        {
          role: "user",
          content: `First, figure out what this question is actually about — do not assume any particular subject area.

Then generate 6-8 short search queries to find relevant passages in the user's personal document collection and remembered facts about THAT subject. Cover BOTH the plain language of the question AND the formal, official, or technical vocabulary a real source would use — expand abbreviations to their full names, include any case/claim/account/reference numbers mentioned verbatim, and add reasonable synonyms.

Question: ${question.slice(0, 600)}

Return a JSON array of short strings only, no markdown: ["q1","q2",...]`,
        },
      ],
    });
    text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  } catch (err) {
    // Never log .message here or anywhere in this module — question text
    // flows into search() as a query, and lib/documents.ts's search()
    // embeds the query verbatim in its own thrown error message. Logging
    // any caught error's message anywhere downstream of that risks leaking
    // question content. Log the error TYPE only.
    console.warn("[ask] query expansion failed — proceeding with the raw question only:", err instanceof Error ? err.name : typeof err);
    return [];
  }

  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as unknown;
    if (Array.isArray(parsed) && parsed.every((q) => typeof q === "string")) {
      const valid = (parsed as string[]).map((q) => q.trim()).filter((q) => q.length > 0);
      if (valid.length > 0) return valid.slice(0, 8);
    }
  } catch {
    // fall through to empty — buildAskQueries still includes the raw question
  }
  return [];
}

async function gatherDocuments(queries: string[]): Promise<DocRef[]> {
  const perQueryHits = await Promise.all(queries.map((q) => search(q, DOC_RESULTS_PER_QUERY).then((r) => r.hits)));

  // Best score per title:page_number, then best-scored page per title —
  // identical merge shape to handle_email.ts/cross_reference.ts.
  const seenPages = new Map<string, { ref: DocRef; score: number }>();
  for (const hits of perQueryHits) {
    for (const h of hits) {
      const pageKey = `${h.title}:${h.page_number}`;
      const score = typeof h.score === "number" ? h.score : 0;
      const existing = seenPages.get(pageKey);
      if (!existing || score > existing.score) {
        seenPages.set(pageKey, {
          ref: {
            doc_id: h.doc_id ?? "",
            title: h.title,
            doc_type: h.doc_type ?? null,
            page: h.page_number,
            snippet: h.snippet.replace(/<\/?mark>/g, "").replace(/\s+/g, " ").trim(),
            highlight: "",
          },
          score,
        });
      }
    }
  }

  const byTitle = new Map<string, { ref: DocRef; score: number }>();
  for (const { ref, score } of seenPages.values()) {
    const existing = byTitle.get(ref.title);
    if (!existing || score > existing.score) byTitle.set(ref.title, { ref, score });
  }

  return Array.from(byTitle.values())
    .sort((a, b) => b.score - a.score)
    .map(({ ref }) => ref);
}

async function gatherMemories(queries: string[], ownerId: string): Promise<MemoryHit[]> {
  const perQueryResults = await Promise.all(queries.map((q) => searchMemories(ownerId, q, MEMORY_RESULTS_PER_QUERY)));

  const seen = new Map<string, MemoryHit>();
  for (const hits of perQueryResults) {
    for (const hit of hits) {
      const existing = seen.get(hit.id);
      if (!existing || hit.score > existing.score) seen.set(hit.id, hit);
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, MAX_MEMORIES);
}

export interface AskResult {
  outcome: AskOutcome;
  citations: Citation[];
}

// Answers ONE question, single-turn, grounded in both documents and
// memories. Throws on a genuine retrieval or model-call failure — the
// caller (app/api/owner/ask/route.ts) turns that into a real HTTP error
// response, never an ungrounded 200.
export async function answerQuestion(ownerId: string, question: string): Promise<AskResult> {
  const generated = await generateAskQueries(question);
  const queries = buildAskQueries(question, generated);

  // Both required — see module header on why neither is allowed to swallow
  // its own failure the way handle_email's memory retrieval optionally does.
  const [docs, memories] = await Promise.all([gatherDocuments(queries), gatherMemories(queries, ownerId)]);

  // Counts only.
  console.log(`[ask] queries=${queries.length} docs=${docs.length} memories=${memories.length}`);

  const documentBlock = buildGroundingBlock(docs);
  const memoryBlock = buildMemoryGroundingBlock(memories);
  const groundingBlock = memoryBlock ? `${documentBlock}\n\n${memoryBlock}` : documentBlock;

  const res = await CLIENT.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{ role: "user", content: buildAnswerUserMessage(question, groundingBlock) }],
  });

  const rawText = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  const outcome = classifyAskOutcome(rawText);
  const citations = outcome.kind === "answered" ? buildCitations(docs, memories) : [];

  return { outcome, citations };
}
