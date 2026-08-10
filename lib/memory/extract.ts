// Owner-stated memory write-back — prompt 5 of the memory-store build. After
// an approved reply is actually SENT (never before — this only ever runs
// post-send-success, fire-and-forget; see the hook in
// app/api/owner/email/send/route.ts), extracts concrete commitments/
// decisions the owner made in that specific reply and persists them via
// writeMemory() with memory_type='owner_stated'.
//
// SCOPE IS DELIBERATELY NARROW: this file writes ONLY owner_stated facts.
// It does NOT extract 'observed' facts from documents (a later prompt) and
// does NOT extract 'inferred_candidate' guesses (a later prompt, which ships
// its own confirmation UI). Writing a candidate or an observed fact from
// here would be out of scope even if it were easy to add.
//
// "Retrieve and cite, never conclude": an owner_stated memory is
// attributable to the owner specifically because it's derived from an
// action they actually took — approving (and possibly editing) and sending
// THIS reply — never from a model's own inference about them. Every memory
// still carries a real source pointer: the sent reply's own Gmail message
// id.

import Anthropic from "@anthropic-ai/sdk";
import { writeMemory } from "./store";
import { searchMemories } from "./retrieve";
import { planOwnerStatedWrites, type OwnerStatedSource } from "./policy";

export interface ExtractOwnerStatedMemoriesParams extends OwnerStatedSource {
  // The FINAL sent draft text — including any edits the owner made in
  // EmailProposalCard before sending. This, not the AI's original proposed
  // draft, is what the owner actually committed to.
  sentDraftText: string;
  subject: string;
}

export interface ExtractOwnerStatedMemoriesResult {
  extracted: number;
  written: number;
  skippedAsDuplicate: number;
}

const CLIENT = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Per-claim dedup lookup cap — small on purpose: an exact-normalized match
// to a claim's own indexed text should rank at or near the top of its own
// full-text search, so this only needs to be big enough to be safe, not
// exhaustive.
const DEDUP_SEARCH_LIMIT = 10;

async function extractClaims(subject: string, sentDraftText: string): Promise<string[]> {
  const res = await CLIENT.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `You are reviewing an email reply that the user just approved and sent, to extract any concrete commitments or decisions THEY made in it.

Extract ONLY clear, factual commitments or decisions the sender made in THIS reply — e.g. "confirmed attendance at the meeting on March 3", "provided a callback number", "agreed to the May 1 deadline". Each extracted claim should be a short, self-contained statement in plain language.

Do NOT extract:
- Facts about the recipient or any third party
- General pleasantries, acknowledgments, or greetings
- Anything not explicitly and literally stated in the reply text
- Guesses, inferences, preferences, or generalizations beyond what's stated
- Vague or generic non-commitments ("will look into it", "thanks for reaching out")

If the reply contains no such commitment, return an empty array — that is the common, expected case, not a failure.

Subject: ${subject || "(none)"}
Sent reply body:
${sentDraftText}

Return JSON only, no markdown: {"claims": ["claim 1", "claim 2", ...]}`,
      },
    ],
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as { claims?: unknown };
    if (Array.isArray(parsed.claims) && parsed.claims.every((c) => typeof c === "string")) {
      return (parsed.claims as string[]).map((c) => c.trim()).filter((c) => c.length > 0);
    }
  } catch {
    // Malformed output — treat as "nothing extracted," never guess at
    // partial/garbled claims.
  }
  return [];
}

// Deterministic, exact-normalized dedup (see policy.ts's isDuplicateClaim) —
// no LLM involved in the dedup decision itself, only in producing the
// candidate claims being checked. One searchMemories() call per extracted
// claim (in parallel) — a single combined query across all claims would
// force AND-semantics over unrelated sentences and reliably match nothing;
// per-claim queries correctly reuse search_memories()'s own scoring/fallback.
async function fetchExistingClaimsFor(ownerId: string, claims: string[]): Promise<string[]> {
  const perClaim = await Promise.all(
    claims.map(async (claim) => {
      try {
        const hits = await searchMemories(ownerId, claim, DEDUP_SEARCH_LIMIT);
        return hits.map((h) => h.claim);
      } catch (err) {
        // A failed dedup lookup for one claim must not block the others —
        // proceed as if nothing existing was found for THIS claim. Worst
        // case is a possible duplicate write, not a lost write; see the
        // module header on why writing is preferred over silently dropping
        // a real commitment when in doubt.
        console.warn("[memory/extract] dedup lookup failed for one claim:", err);
        return [];
      }
    })
  );
  return [...new Set(perClaim.flat())];
}

// Extracts and persists owner_stated memories from one sent reply. Safe to
// call and await directly, but the send path calls this fire-and-forget
// (`void extractOwnerStatedMemories(...).catch(...)`) — see
// app/api/owner/email/send/route.ts. A rejection here must never be treated
// as a send failure by any caller.
export async function extractOwnerStatedMemories(
  params: ExtractOwnerStatedMemoriesParams
): Promise<ExtractOwnerStatedMemoriesResult> {
  const claims = await extractClaims(params.subject, params.sentDraftText);

  if (claims.length === 0) {
    console.log("[memory/extract] extracted=0 written=0 duplicate=0");
    return { extracted: 0, written: 0, skippedAsDuplicate: 0 };
  }

  const existingClaims = await fetchExistingClaimsFor(params.ownerId, claims);
  const { toWrite, skippedAsDuplicate } = planOwnerStatedWrites(claims, existingClaims, params);

  let written = 0;
  for (const input of toWrite) {
    try {
      await writeMemory(input);
      written++;
    } catch (err) {
      // One claim failing to write must not stop the others, and must
      // never propagate — the outer fire-and-forget hook is a second,
      // redundant safety net, not the only one.
      console.warn("[memory/extract] failed to write one extracted claim:", err);
    }
  }

  // Counts only — never claim text, email content, or draft text.
  console.log(
    `[memory/extract] extracted=${claims.length} written=${written} duplicate=${skippedAsDuplicate}`
  );

  return { extracted: claims.length, written, skippedAsDuplicate };
}
