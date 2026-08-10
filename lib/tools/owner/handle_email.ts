import type { ToolDefinition } from "../registry";
import type { EmailProposal } from "@/lib/types";
import { logOwnerAction } from "@/lib/owner-actions";
import { search } from "@/lib/documents";
import { isDbConfigured } from "@/lib/db";
import { searchMemories, type MemoryHit } from "@/lib/memory/retrieve";
import {
  type EmailBodyProvenance,
  buildSourceContentStatusBlock,
  resolveTrustedEmailContent,
  deriveModelContextProvenance,
} from "@/lib/gmail";
import {
  type DocRef,
  type QueryResult,
  selectRelevantDocuments,
  classifySensitiveDocument,
  emailExplicitlyMentionsSensitiveCategory,
  buildGroundingBlock,
  buildMemoryGroundingBlock,
  buildDraftUserMessage,
  buildTriageUserMessage,
} from "./handle_email_grounding";
import { extractIdentifierAnchors } from "./query-anchors";
import Anthropic from "@anthropic-ai/sdk";

// Triage only classifies (actionable/needs_caleb/ignore) — it doesn't need the
// full body for that, so its prompt caps the text for cost. Any call that
// caps its own input MUST describe that cap truthfully to the model via
// deriveModelContextProvenance — see triageEmail below — rather than let the
// SOURCE CONTENT STATUS block claim "not locally truncated" for text this
// specific call never actually received.
const TRIAGE_TEXT_CAP = 1200;

// ─── Internal reasoning steps ─────────────────────────────────────────────────

async function triageEmail(
  client: Anthropic,
  emailText: string,
  sender: string,
  subject: string,
  provenance: EmailBodyProvenance | undefined
): Promise<{ classification: EmailProposal["classification"]; reason: string; replyRequired: boolean }> {
  // Model-CONTEXT completeness for this specific call, not source provenance —
  // if this call's own cap actually cut the text, the model must be told so,
  // even when the source itself was fully retrieved. The source `provenance`
  // passed in is never mutated and stays what gets returned/stored.
  const triageProvenance = deriveModelContextProvenance(provenance, emailText.length > TRIAGE_TEXT_CAP);
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: buildSourceContentStatusBlock(triageProvenance),
    messages: [
      {
        role: "user",
        content: buildTriageUserMessage(emailText, sender, subject, TRIAGE_TEXT_CAP),
      },
    ],
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  try {
    // Strip potential markdown fences before parsing
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as { classification: string; reply_required?: unknown; reason: string };
    const cls = parsed.classification;
    if (cls === "actionable" || cls === "needs_caleb" || cls === "ignore") {
      // Safe default when the model omits or malforms this field: true —
      // preserves prior behavior (always draft a reply) rather than silently
      // skipping a reply that was actually needed.
      const replyRequired = typeof parsed.reply_required === "boolean" ? parsed.reply_required : true;
      return { classification: cls, reason: String(parsed.reason ?? ""), replyRequired };
    }
  } catch {
    // fall through to default
  }
  return {
    classification: "needs_caleb",
    reason: "Could not auto-classify — review manually.",
    replyRequired: true,
  };
}

// DocRef (imported from ./handle_email_grounding) carries the actual
// retrieved excerpt so the draft is grounded in document text, not inferred
// from the email's wording.

// generateSearchQueries expands the email intent into multiple FTS-friendly
// queries covering BOTH the email's surface language AND the formal/official
// vocabulary a real document on that topic would use — without assuming
// which topic. It bridges the gap between how a sender phrases a request
// (e.g. "proof you're covered") and how the matching document is actually
// worded (e.g. "policy number", "coverage effective date").
async function generateSearchQueries(
  client: Anthropic,
  emailText: string,
  subject: string
): Promise<string[]> {
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    messages: [
      {
        role: "user",
        content: `First, figure out what this email is actually about — do not assume any particular subject area (it could be immigration, housing, insurance, invoices, medical care, school enrollment, a lease, anything).

Then generate 6-8 short search queries to find relevant passages in the user's personal document collection about THAT topic. Cover BOTH the plain/surface language the sender used AND the formal, official, or technical terms a real document on that topic would use — expand abbreviations to their full names, include any case/claim/account/invoice/reference numbers mentioned verbatim, and add reasonable synonyms.

Example — if an email asks for "proof you're covered under the family plan", good queries include:
"family plan coverage", "insurance policy", "dependent coverage", "policy number", "proof of coverage", plus any specific numbers or codes named in the email.

Email subject: ${subject || "(none)"}
Email body excerpt: ${emailText.slice(0, 800)}

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
    // fall through to fallback
  }
  // Fallback: single naive query
  return [[subject, emailText.slice(0, 200)].filter(Boolean).join(" ")];
}

async function gatherDocuments(llmQueries: string[], sourceText: string): Promise<DocRef[]> {
  // Anchor queries are extracted deterministically from THIS email's actual
  // text (see ./query-anchors) — the domain-neutral replacement for the old
  // hardcoded FIXED_QUERIES list. Merge with LLM queries, deduplicated. A
  // query string independently produced by the LLM (even if it happens to
  // match an anchor verbatim) is tagged "llm" — the LLM generating it FROM
  // the email's actual content is itself a relevance signal an anchor alone
  // doesn't carry (see selectRelevantDocuments's corroboration requirement).
  const llmQuerySet = new Set(llmQueries);
  const anchorQueries = extractIdentifierAnchors(sourceText);
  const allQueries = [...new Set([...anchorQueries, ...llmQueries])];
  // Counts only — query strings are derived from the email's own content
  // (see generateSearchQueries) and must not land in logs any more than the
  // email body itself.
  console.log(
    `[handle_email] ${allQueries.length} queries total` +
      ` (${anchorQueries.length} anchor + ${llmQueries.length} from LLM)`
  );

  // Run all queries in parallel; limit per query so the total set stays manageable.
  const perQueryResults: QueryResult[] = await Promise.all(
    allQueries.map(async (q): Promise<QueryResult> => {
      const origin = llmQuerySet.has(q) ? "llm" : "fixed";
      try {
        const { hits } = await search(q, 8);
        return { query: q, origin, hits };
      } catch (err) {
        console.warn(`[handle_email] search error (${origin} query):`, err);
        return { query: q, origin, hits: [] };
      }
    })
  );

  // Counts only — hit titles/doc_ids indirectly reveal which query (and thus
  // which part of the email) matched, so they stay out of logs too.
  const allRawHits = perQueryResults.flatMap((r) => r.hits);
  console.log(`[handle_email] ${allRawHits.length} raw hit(s) before relevance filtering`);

  // Score threshold + "found by at least one LLM-generated (email-derived)
  // query" requirement — see selectRelevantDocuments in
  // ./handle_email_grounding for the full rationale. A document found ONLY
  // via fixed queries is dropped here, not merely deprioritized.
  const merged = selectRelevantDocuments(perQueryResults);

  console.log(`[handle_email] ${merged.length} relevant document(s) after filtering`);
  return merged;
}

// Memory retrieval is document retrieval pointed at a new corpus (see
// lib/memory/retrieve.ts) — same relevance-first discipline, never a blanket
// dump of everything the owner is known to believe. Reuses the SAME
// LLM-generated queries already produced for document search above, so this
// wiring introduces no separate query-generation step or extra LLM call.
const MEMORY_RESULTS_PER_QUERY = 5;
const MAX_MEMORIES = 5;

async function gatherMemories(llmQueries: string[], ownerId: string): Promise<MemoryHit[]> {
  const perQueryResults = await Promise.all(
    llmQueries.map(async (q) => {
      try {
        return await searchMemories(ownerId, q, MEMORY_RESULTS_PER_QUERY);
      } catch (err) {
        console.warn("[handle_email] memory search error:", err);
        return [];
      }
    })
  );

  // Dedupe by id, keeping the best score per memory across queries — same
  // merge shape as gatherDocuments above.
  const seen = new Map<string, MemoryHit>();
  for (const hits of perQueryResults) {
    for (const hit of hits) {
      const existing = seen.get(hit.id);
      if (!existing || hit.score > existing.score) seen.set(hit.id, hit);
    }
  }

  const merged = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, MAX_MEMORIES);
  // Count only — claim text and source content stay out of logs.
  console.log(`[handle_email] ${merged.length} memory match(es) after merging`);
  return merged;
}

async function draftEmailReply(
  client: Anthropic,
  emailText: string,
  sender: string,
  subject: string,
  docs: DocRef[],
  memories: MemoryHit[],
  provenance: EmailBodyProvenance | undefined
): Promise<string> {
  // Build the grounding block — the ONLY source of facts the draft may use
  // about the user. When zero documents are relevant, this explicitly says
  // so rather than the model silently having nothing and improvising.
  // Memories are appended as a SEPARATE block (see buildMemoryGroundingBlock)
  // rather than merged into buildGroundingBlock itself, so this wiring stays
  // small and reversible — removing the memory block below fully reverts to
  // document-only grounding with zero change to buildGroundingBlock.
  const documentGroundingBlock = buildGroundingBlock(docs);
  const memoryGroundingBlock = buildMemoryGroundingBlock(memories);
  const groundingBlock = memoryGroundingBlock
    ? `${documentGroundingBlock}\n\n${memoryGroundingBlock}`
    : documentGroundingBlock;

  // Unlike triageEmail, this call applies no local cap — the full (possibly
  // already source-truncated) emailText is sent below, so the source
  // provenance describes this call's actual context accurately as-is. Routed
  // through the same helper as triageEmail for symmetry and so the "no cap
  // applied" fact is explicit and structurally identical if a cap is ever
  // added here later.
  const draftProvenance = deriveModelContextProvenance(provenance, false);
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: buildSourceContentStatusBlock(draftProvenance),
    messages: [
      {
        role: "user",
        content: buildDraftUserMessage(emailText, sender, subject, groundingBlock),
      },
    ],
  });

  return res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const handle_email: ToolDefinition = {
  name: "handle_email",
  description:
    "Triages a pasted email, searches your documents and previously confirmed remembered facts for relevant context, and drafts a proposed reply in your voice. Returns a structured proposal you must approve before anything happens — never sends automatically. email_text should be the COMPLETE message body — if you only have a Gmail preview snippet, call read_gmail_message first to get the full text before calling this.",
  input_schema: {
    type: "object",
    properties: {
      email_text: {
        type: "string",
        description: "Full body text of the email to handle.",
      },
      sender: {
        type: "string",
        description: "Sender email address or name (optional).",
      },
      subject: {
        type: "string",
        description: "Email subject line (optional).",
      },
      gmail_thread_id: {
        type: "string",
        description: "Gmail threadId of the email being replied to (optional — enables correct threading in Gmail).",
      },
      gmail_message_id: {
        type: "string",
        description: "Gmail messageId of the specific message being replied to (optional — sets In-Reply-To header).",
      },
    },
    required: ["email_text"],
  },
  lane: "owner",
  statusLabel: "reading your email…",
  // Only the opaque Gmail IDs may survive into tool_runs.input — never
  // email_text/sender/subject, which is the entire point of this tool's
  // custody guarantee.
  loggableInputKeys: ["gmail_thread_id", "gmail_message_id"],
  execute: async (input, ctx) => {
    const rawEmailText = typeof input.email_text === "string" ? input.email_text.trim() : "";
    const sender = typeof input.sender === "string" ? input.sender.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const gmailThreadId = typeof input.gmail_thread_id === "string" ? input.gmail_thread_id.trim() : undefined;
    const gmailMessageId = typeof input.gmail_message_id === "string" ? input.gmail_message_id.trim() : undefined;

    // Trust boundary: when a trusted cache entry exists for gmail_message_id,
    // its EXACT retrieved text overrides whatever email_text the model
    // supplied here — not just the provenance label. This structurally
    // prevents the model from altering, paraphrasing, truncating, or
    // prompt-injection-altering the text between a genuine read_gmail_message
    // fetch and this call. See lib/gmail.ts:resolveTrustedEmailContent.
    const { text: emailText, provenance: bodyProvenance, usedTrustedCachedText, textHash } =
      resolveTrustedEmailContent(input, rawEmailText, ctx);

    if (!emailText) return JSON.stringify({ error: "email_text is required" });

    // Content-free observability record: an id and a boolean/hash, never text.
    console.log(
      `[handle_email] gmail_message_id=${gmailMessageId ?? "none"} ` +
        `used_trusted_cached_text=${usedTrustedCachedText}` +
        (textHash ? ` text_hash=${textHash}` : "")
    );

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // TRIAGE
    ctx.onStatus?.("Triage request");
    const { classification, reason, replyRequired } = await triageEmail(
      client,
      emailText,
      sender,
      subject,
      bodyProvenance
    );

    // ACTION GROUNDING vs. REPLY DRAFTING — deliberately separate concerns,
    // gated independently:
    //   - Document search/retrieval runs for every "actionable" email,
    //     regardless of replyRequired. A non-reply action (e.g. "complete
    //     your application in the portal") can still genuinely need internal
    //     documents to determine or explain the action correctly — gating
    //     retrieval on replyRequired would silently starve those actions of
    //     grounding they may need, which is not what replyRequired means.
    //   - Reply DRAFTING is gated on replyRequired specifically: when the
    //     required action happens elsewhere (a portal, a payment page, in
    //     person), there is no reply to write, and forcing a draft-reply
    //     workflow onto an action that doesn't need one produces an empty or
    //     invented reply. `reason` (from triage) already carries the
    //     concrete action.
    let matchedDocs: DocRef[] = [];
    let draftReply: string | null = null;

    if (classification === "actionable") {
      ctx.onStatus?.("Translate language");
      const llmQueries = await generateSearchQueries(client, emailText, subject);

      ctx.onStatus?.("Search documents");
      matchedDocs = await gatherDocuments(llmQueries, emailText);

      // Owner-scoped memory retrieval — see lib/memory/retrieve.ts. Skipped
      // cleanly (empty result, no error) when the owner isn't configured or
      // the DB isn't available; memory grounding is additive, never a
      // requirement for handle_email to function.
      const ownerId = process.env.OWNER_CLERK_USER_ID;
      let matchedMemories: MemoryHit[] = [];
      if (ownerId && isDbConfigured()) {
        ctx.onStatus?.("Search memory");
        matchedMemories = await gatherMemories(llmQueries, ownerId);
      }

      if (replyRequired) {
        ctx.onStatus?.("Draft response");
        draftReply = await draftEmailReply(
          client,
          emailText,
          sender,
          subject,
          matchedDocs,
          matchedMemories,
          bodyProvenance
        );
      }
    }

    ctx.onStatus?.("Wait for approval");

    // matchedDocs is already deduped by title and relevance-filtered by
    // gatherDocuments/selectRelevantDocuments — these remain the grounding
    // sources shown as citations, present regardless of replyRequired (see
    // above). The full array was already passed to draftEmailReply for
    // context when a draft was produced.
    const dedupedDocs = matchedDocs;

    // Suggested ATTACHMENTS are a stricter, separate gate from citations:
    //   1. Never suggested at all when replyRequired is false — there is no
    //      reply being sent, so there is nothing to attach a file TO.
    //      Citations above are unaffected; grounding can inform the
    //      recommended action without there being a reply to attach to.
    //   2. Even when a reply IS required, sensitive documents (immigration/
    //      legal-status/identity/medical/financial/government) are
    //      deny-by-default: excluded unless the email's own text explicitly
    //      mentions that category. The "user has not already supplied it"
    //      and "Tacit explains why" conditions from the spec cannot
    //      currently be verified here (this tool has no visibility into the
    //      source email's own attachments), so this is a
    //      necessary-but-not-sufficient, safety-biased gate, not a complete
    //      implementation of all three conditions. This is what stops an
    //      I-360 approval notice from being suggested as an attachment on a
    //      housing-application reply.
    let attachmentCandidates: DocRef[] = [];
    if (replyRequired) {
      const emailMentionsSensitiveCategory = emailExplicitlyMentionsSensitiveCategory(emailText);
      attachmentCandidates = dedupedDocs.filter((d) => {
        if (!classifySensitiveDocument(d.title, d.doc_type)) return true;
        return emailMentionsSensitiveCategory;
      });
    }

    // Build the reply subject: prepend "Re: " if not already present.
    const replySubject =
      subject && !/^re:/i.test(subject.trim()) ? `Re: ${subject}` : subject;

    const proposal: EmailProposal = {
      classification,
      reason,
      reply_required: replyRequired,
      matched_documents: dedupedDocs,
      draft_reply: draftReply,
      suggested_attachments: attachmentCandidates.map((d) => d.title),
      recipient: sender || undefined,
      reply_subject: replySubject || undefined,
      thread_id: gmailThreadId,
      in_reply_to_id: gmailMessageId,
      attachment_doc_ids: attachmentCandidates.map((d) => d.doc_id).filter((id): id is string => !!id),
      needs_approval: true,
      body_provenance: bodyProvenance,
    };

    // Classification only — never sender/subject/body. See lib/redact.ts and
    // this tool's loggableInputKeys for the same guarantee on tool_runs.input.
    void logOwnerAction("handle_email", { classification });

    // _proposal is extracted by the agent loop before the model sees the result.
    return JSON.stringify({
      status: "proposal_ready",
      classification,
      reason,
      _proposal: proposal,
    });
  },
};
