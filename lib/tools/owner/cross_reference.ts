import type { ToolDefinition } from "../registry";
import { search } from "@/lib/documents";
import { logOwnerAction } from "@/lib/owner-actions";
import { extractIdentifierAnchors } from "./query-anchors";
import Anthropic from "@anthropic-ai/sdk";

// ─── Helpers (parallel to handle_email internals) ─────────────────────────────

type DocRef = {
  doc_id: string;
  title: string;
  page: number;
  snippet: string;
  highlight: string;
};

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

async function generateQueries(client: Anthropic, question: string): Promise<string[]> {
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    messages: [
      {
        role: "user",
        content: `First, figure out what subject area this question is actually about — do not assume any particular domain (it could be immigration, housing, insurance, finance, employment, medical care, anything).

Then generate 6-8 short search queries to find relevant passages in the user's personal document collection about THAT subject. Cover BOTH the plain language the question uses AND the formal, official, or technical vocabulary a real document on that subject would use — expand abbreviations to their full names, include any case/claim/account/reference numbers named verbatim, and add reasonable synonyms.

Question: ${question.slice(0, 600)}

Return a JSON array of short strings only, no markdown: ["q1","q2",...]`,
      },
    ],
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as unknown;
    if (Array.isArray(parsed) && parsed.every((q) => typeof q === "string")) {
      const valid = (parsed as string[]).map((q) => q.trim()).filter((q) => q.length > 0);
      if (valid.length > 0) return valid.slice(0, 8);
    }
  } catch {
    // fall through to single-query fallback
  }
  return [question.slice(0, 200)];
}

// Unlike handle_email (which keeps one best page per document), cross_reference
// keeps up to MAX_PAGES_PER_DOC pages per document so the reasoning step has
// richer intra-document context. Still caps total documents at MAX_DOCS so the
// reasoning prompt stays focused.
const MAX_PAGES_PER_DOC = 2;
const MAX_DOCS = 6;

async function gatherPassages(llmQueries: string[], sourceText: string): Promise<DocRef[]> {
  // Anchor queries are extracted deterministically from THIS question's
  // actual text (see ./query-anchors) — the domain-neutral replacement for
  // the old hardcoded immigration-term FIXED_QUERIES list.
  const anchorQueries = extractIdentifierAnchors(sourceText);
  const allQueries = [...new Set([...anchorQueries, ...llmQueries])];
  // Counts only — query strings are derived from the question's own content
  // and must not land in logs.
  console.log(
    `[cross_reference] ${allQueries.length} queries` +
      ` (${anchorQueries.length} anchor + ${llmQueries.length} from LLM)`
  );

  const perQueryHits = await Promise.all(
    allQueries.map(async (q) => {
      try {
        const { hits } = await search(q, 8);
        return hits;
      } catch (err) {
        console.warn("[cross_reference] search error:", err);
        return [];
      }
    })
  );

  // Deduplicate pages — best score per title:page_number.
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
            page: h.page_number,
            snippet: cleanSnippet(h.snippet),
            highlight: extractHighlight(h.snippet),
          },
          score,
        });
      }
    }
  }

  // Group by document title; sort pages within each doc by score descending.
  const byTitle = new Map<string, { ref: DocRef; score: number }[]>();
  for (const entry of seenPages.values()) {
    const bucket = byTitle.get(entry.ref.title) ?? [];
    bucket.push(entry);
    byTitle.set(entry.ref.title, bucket);
  }

  // Pick top MAX_DOCS documents (by their best-page score), then top
  // MAX_PAGES_PER_DOC pages from each.
  const sortedDocs = Array.from(byTitle.entries())
    .map(([, pages]) => ({
      pages: pages.sort((a, b) => b.score - a.score),
      bestScore: pages.reduce((m, p) => Math.max(m, p.score), 0),
    }))
    .sort((a, b) => b.bestScore - a.bestScore)
    .slice(0, MAX_DOCS);

  const result: DocRef[] = [];
  for (const { pages } of sortedDocs) {
    result.push(...pages.slice(0, MAX_PAGES_PER_DOC).map(({ ref }) => ref));
  }

  // Counts only — document titles stay out of logs.
  console.log(
    `[cross_reference] ${result.length} passage(s) across ${sortedDocs.length} document(s)`
  );
  return result;
}

// ─── Reasoning step ───────────────────────────────────────────────────────────
// Connects what the documents jointly show. Hard-constrained to only reference
// retrieved passages and never draw legal or eligibility conclusions.

type GroundedFact = { doc: string; page: number; excerpt: string };

type ReasoningResult = {
  grounded_facts: GroundedFact[];
  observation: string;
  conflicts: string[];
};

async function reasonAcrossDocuments(
  client: Anthropic,
  question: string,
  docs: DocRef[]
): Promise<ReasoningResult> {
  if (docs.length === 0) {
    return {
      grounded_facts: [],
      observation: "No relevant passages found across your documents for this question.",
      conflicts: [],
    };
  }

  const groundingBlock = docs
    .map((d) => `[${d.title} · p.${d.page}]\n"${d.snippet}"`)
    .join("\n\n");

  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: `You are a document analyst doing an "underwriter cross-check": given passages from multiple documents, observe how they connect — like a mortgage underwriter cross-referencing a bank statement against a tax return.

HARD RULES — each is a failure condition if violated:
1. Every fact you state MUST trace to one of the retrieved passages below. No fact without a source.
2. You may connect facts that are each independently cited. Example: "Document A (p.1) shows reference number SL6; Document B (p.1) lists category C14, which references the same account."
3. You may NOT conclude eligibility, legal status, or what anything means for the reader. Surface the connection only — never say "therefore you qualify" or "this means you are eligible."
4. If two passages appear to conflict, FLAG both with citations rather than resolving the conflict.
5. If you cannot ground a connection in the retrieved text, say so plainly — "the documents don't jointly show this."
6. Use "the document states" / "the passage shows" — not "you are" / "you have" / "you qualify."

Question: ${question}

Retrieved passages:
${groundingBlock}

Return JSON only, no markdown:
{
  "grounded_facts": [
    { "doc": "<exact document title from above>", "page": <number>, "excerpt": "<direct quote or near-verbatim from the passage>" }
  ],
  "observation": "<what the passages jointly show — cite inline as (Doc Title p.N). no legal conclusions.>",
  "conflicts": ["<description of apparent conflict, citing both documents and pages>"]
}`,
      },
    ],
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";

  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as {
      grounded_facts?: unknown;
      observation?: unknown;
      conflicts?: unknown;
    };

    const grounded_facts = Array.isArray(parsed.grounded_facts)
      ? (parsed.grounded_facts as GroundedFact[])
      : docs.map((d) => ({ doc: d.title, page: d.page, excerpt: d.snippet.slice(0, 200) }));

    const observation =
      typeof parsed.observation === "string" && parsed.observation.trim()
        ? parsed.observation.trim()
        : "Could not establish a clear connection from the retrieved passages.";

    const conflicts = Array.isArray(parsed.conflicts)
      ? (parsed.conflicts as string[]).filter((c) => typeof c === "string")
      : [];

    return { grounded_facts, observation, conflicts };
  } catch {
    return {
      grounded_facts: docs.map((d) => ({ doc: d.title, page: d.page, excerpt: d.snippet.slice(0, 200) })),
      observation: "Could not parse cross-document analysis. Review the grounded facts directly.",
      conflicts: [],
    };
  }
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const cross_reference: ToolDefinition = {
  name: "cross_reference",
  description:
    "Cross-references MULTIPLE documents to observe how they relate — the 'underwriter move'. " +
    "Use when a question spans more than one document or requires connecting facts across sources. " +
    "Retrieves grounded passages from each relevant document, then observes what they jointly show. " +
    "Does NOT conclude eligibility or legal status — surfaces connections with citations only. " +
    "Example use: 'How does document A relate to document B?' or 'Do my documents show a consistent account history?'",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The question or topic to investigate across multiple documents. Be specific — e.g. 'How does my lease relate to my move-in inspection report?' or 'What reference number connects my invoice to my payment confirmation?'",
      },
    },
    required: ["question"],
  },
  lane: "owner",
  statusLabel: "cross-referencing your documents…",
  execute: async (input, ctx) => {
    const question = typeof input.question === "string" ? input.question.trim() : "";
    if (!question) return JSON.stringify({ error: "question is required" });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    ctx.onStatus?.("Translating question into document language");
    const llmQueries = await generateQueries(client, question);

    ctx.onStatus?.("Searching all documents");
    const docs = await gatherPassages(llmQueries, question);

    ctx.onStatus?.("Connecting facts across documents");
    const { grounded_facts, observation, conflicts } = await reasonAcrossDocuments(
      client,
      question,
      docs
    );

    void logOwnerAction("cross_reference", {
      question: question.slice(0, 200),
      doc_count: docs.length,
      fact_count: grounded_facts.length,
    });

    return JSON.stringify({
      grounded_facts,
      observation,
      ...(conflicts.length > 0 ? { conflicts } : {}),
      note: "These are retrieved passages and observed connections between them — not legal conclusions or eligibility determinations. Verify each claim against the cited document pages.",
    });
  },
};
