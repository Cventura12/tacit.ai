// Pasted-text candidate extraction — memory Phase 2 (paste mode). Owner
// pastes a chunk of text (a session transcript, notes, direct dictation);
// one model call proposes candidate memories; nothing becomes a real memory
// until the owner confirms it via the EXISTING confirmCandidate path (see
// app/api/owner/memory/resolve/route.ts). This module only ever writes
// memory_type='inferred_candidate' — unconfirmed, inert until approved.
//
// EXTRACTION QUALITY IS THE WHOLE PHASE. The prompt below is biased hard
// toward precision over recall: a missed claim costs nothing (the owner can
// paste or say it again), but a wrong or mangled one that gets confirmed
// without a second look corrupts the store. When uncertain, the model is
// told to drop, not guess. A long list the owner has to police is exactly
// the "work I could've done myself" failure this whole phase exists to
// avoid — see the module policy.ts's PastedTextSource/ExtractedCandidate
// types for the shape this produces.
//
// Mirrors lib/memory/extract.ts's split: this file does the real I/O (one
// LLM call, per-candidate dedup lookups, writeMemory calls); all planning
// logic (what counts as a duplicate, what to write) is pure and lives in
// policy.ts, unit-tested directly — see extract_pasted.test.ts.

import Anthropic from "@anthropic-ai/sdk";
import { writeMemory } from "./store";
import { searchMemories } from "./retrieve";
import {
  planPastedCandidateWrites,
  type ExtractedCandidate,
  type ExistingMemoryClaim,
  type PastedTextSource,
} from "./policy";

export interface ExtractPastedParams {
  ownerId: string;
  text: string;
  label?: string;
}

export interface WrittenCandidate {
  id: string;
  claim: string;
  reason: string;
}

export interface AlreadyKnownCandidate {
  claim: string;
  reason: string;
  existing_id: string;
  existing_claim: string;
}

export interface ExtractPastedResult {
  source_id: string;
  candidates: WrittenCandidate[];
  already_known: AlreadyKnownCandidate[];
}

const CLIENT = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Generous but bounded — a full session transcript can legitimately be this
// long; the cap exists to bound cost/latency, not to slice mid-thought.
export const MAX_PASTE_LEN = 40000;

// Per-claim dedup lookup cap — same reasoning as extract.ts's
// DEDUP_SEARCH_LIMIT: an exact-normalized match to a claim's own indexed
// text should rank at or near the top of its own full-text search.
const DEDUP_SEARCH_LIMIT = 10;

async function extractCandidates(text: string): Promise<ExtractedCandidate[]> {
  const res = await CLIENT.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are reading a chunk of pasted text — likely a session transcript, notes, or direct dictation — to extract DURABLE facts worth remembering long-term about the person or their situation.

Extract ONLY concrete, durable claims:
- Stated facts about their circumstances or situation
- Decisions already made
- Direction or intent they've explicitly committed to (e.g. "I'm doing X", "the plan is Y")

Do NOT extract:
- Hedges or hypotheticals ("maybe I should...", "what if...", "I might...")
- Thinking-out-loud, brainstorming, or exploring an idea without committing to it
- Questions
- Anything clearly still in flux or provisional
- Facts about third parties rather than the person themselves

BIAS HARD TOWARD PRECISION OVER RECALL. When you are not confident something is a durable, settled fact rather than thinking-out-loud, DO NOT extract it — skip it. A missed claim costs nothing; a wrong or mangled one is worse than not extracting at all. Fewer, cleaner candidates are strictly better than a long list. If nothing in the text clearly qualifies, return an empty array — that is the normal, expected, common case, not a failure.

For each candidate you DO extract, provide exactly three fields:
- "claim": a short, self-contained statement in plain language
- "reason": ONE short phrase naming why this counts as durable — e.g. "stated as a direction", "stated as a fact about your situation", "stated as a decision already made"
- "excerpt": the exact short verbatim span (a single sentence or clause, NOT the whole paste) that this claim is grounded in — quote it directly from the text below, do not paraphrase it

Text:
${text}

Return JSON only, no markdown: {"candidates": [{"claim": "...", "reason": "...", "excerpt": "..."}]}`,
      },
    ],
  });

  const raw = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) return [];
    return parsed.candidates
      .filter(
        (c): c is { claim: unknown; reason: unknown; excerpt: unknown } => typeof c === "object" && c !== null
      )
      .map((c) => ({
        claim: typeof c.claim === "string" ? c.claim.trim() : "",
        reason: typeof c.reason === "string" ? c.reason.trim() : "",
        excerpt: typeof c.excerpt === "string" ? c.excerpt.trim() : "",
      }))
      // A candidate missing a claim or its justifying excerpt is dropped,
      // not written with a gap — same "when uncertain, drop" bias applied
      // structurally, not just by prompt instruction.
      .filter((c) => c.claim.length > 0 && c.excerpt.length > 0);
  } catch {
    // Malformed output — treat as "nothing extracted," never guess at
    // partial/garbled candidates.
    return [];
  }
}

// One searchMemories() call per candidate claim (in parallel) — mirrors
// extract.ts's fetchExistingClaimsFor exactly, except this keeps {id, claim}
// pairs (not just claim text) because planPastedCandidateWrites needs the
// existing memory's own id to report an "already known" match precisely.
async function fetchExistingMemoriesFor(
  ownerId: string,
  candidates: ExtractedCandidate[]
): Promise<ExistingMemoryClaim[]> {
  const perCandidate = await Promise.all(
    candidates.map(async (c) => {
      try {
        const hits = await searchMemories(ownerId, c.claim, DEDUP_SEARCH_LIMIT);
        return hits.map((h) => ({ id: h.id, claim: h.claim }));
      } catch (err) {
        // A failed dedup lookup for one candidate must not block the
        // others — proceed as if nothing existing was found for THIS
        // candidate. Worst case is a possible duplicate candidate, not a
        // lost one.
        console.warn("[memory/extract_pasted] dedup lookup failed for one candidate:", err instanceof Error ? err.name : typeof err);
        return [];
      }
    })
  );
  const seen = new Map<string, ExistingMemoryClaim>();
  for (const m of perCandidate.flat()) seen.set(m.id, m);
  return [...seen.values()];
}

export async function extractPastedCandidates(params: ExtractPastedParams): Promise<ExtractPastedResult> {
  const sourceId = crypto.randomUUID();
  const source: PastedTextSource = {
    ownerId: params.ownerId,
    sourceId,
    label: params.label,
    extractedAt: new Date().toISOString(),
  };

  const extracted = await extractCandidates(params.text);

  if (extracted.length === 0) {
    console.log("[memory/extract_pasted] extracted=0 written=0 already_known=0");
    return { source_id: sourceId, candidates: [], already_known: [] };
  }

  const existingMemories = await fetchExistingMemoriesFor(params.ownerId, extracted);
  const { toWrite, alreadyKnown } = planPastedCandidateWrites(extracted, existingMemories, source);

  const candidates: WrittenCandidate[] = [];
  for (const { input, reason } of toWrite) {
    try {
      const memory = await writeMemory(input);
      candidates.push({ id: memory.id, claim: memory.claim, reason });
    } catch (err) {
      // One candidate failing to write must not stop the others.
      console.warn("[memory/extract_pasted] failed to write one candidate:", err instanceof Error ? err.name : typeof err);
    }
  }

  // Counts/ids only — never claim, reason, or excerpt text, and never the
  // pasted text itself.
  console.log(
    `[memory/extract_pasted] source_id=${sourceId} extracted=${extracted.length} written=${candidates.length} already_known=${alreadyKnown.length}`
  );

  return { source_id: sourceId, candidates, already_known: alreadyKnown };
}
