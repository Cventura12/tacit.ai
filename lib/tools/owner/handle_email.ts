import type { ToolDefinition } from "../registry";
import type { EmailProposal } from "@/lib/types";
import { logOwnerAction } from "@/lib/owner-actions";
import { search } from "@/lib/documents";
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
  buildDraftUserMessage,
} from "./handle_email_grounding";
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
): Promise<{ classification: EmailProposal["classification"]; reason: string }> {
  // Model-CONTEXT completeness for this specific call, not source provenance —
  // if this call's own cap actually cut the text, the model must be told so,
  // even when the source itself was fully retrieved. The source `provenance`
  // passed in is never mutated and stays what gets returned/stored.
  const triageProvenance = deriveModelContextProvenance(provenance, emailText.length > TRIAGE_TEXT_CAP);
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    system: buildSourceContentStatusBlock(triageProvenance),
    messages: [
      {
        role: "user",
        content: `You are triaging email for Caleb Ventura. Your default is to draft a reply — refusals waste his time.

DEFAULT: classify as "actionable" unless a specific exception below applies. This covers any email from a real person asking any question or requesting any reply — about his project, documents, schedule, preferences, status, or anything else. Topic doesn't matter. The draft step handles grounding; triage only decides whether to attempt a draft.

Classify as "needs_caleb" ONLY when the email requires a genuine decision with real stakes that only he can make:
- Accepting or declining an offer (job, contract, enrollment slot, proposal)
- Committing money or signing something with legal consequence
- Choosing between meaningful options where the answer isn't obvious from context (e.g. "which of these two job offers do you prefer?")
- A personal opinion or judgment call no one else can make for him
NOTE: "which email should I use for you?" is NOT needs_caleb if context makes the answer obvious — draft it. When in doubt, choose actionable.

Classify as "ignore" ONLY when:
- True spam, mass marketing, or newsletters
- Fully automated no-reply notification (no human waiting on a response)
A real person asking a real question is NEVER "ignore."

Email:
From: ${sender || "(unknown)"}
Subject: ${subject || "(no subject)"}
Body: ${emailText.slice(0, TRIAGE_TEXT_CAP)}

Return JSON only, no markdown: {"classification":"actionable"|"needs_caleb"|"ignore","reason":"one sentence"}`,
      },
    ],
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  try {
    // Strip potential markdown fences before parsing
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as { classification: string; reason: string };
    const cls = parsed.classification;
    if (cls === "actionable" || cls === "needs_caleb" || cls === "ignore") {
      return { classification: cls, reason: String(parsed.reason ?? "") };
    }
  } catch {
    // fall through to default
  }
  return { classification: "needs_caleb", reason: "Could not auto-classify — review manually." };
}

// DocRef (imported from ./handle_email_grounding) carries the actual
// retrieved excerpt so the draft is grounded in document text, not inferred
// from the email's wording.

// Fixed queries that run on EVERY handle_email call regardless of what the LLM
// generates. Short form-number tokens are OCR-stable and reliably match the
// indexed text even when OCR quality is imperfect. Crucially, a document
// found ONLY via one of these — never independently by an LLM-generated,
// email-content-derived query — is not treated as grounded; see
// selectRelevantDocuments in ./handle_email_grounding for why (this is the
// fix for the Tennessee Tech housing incident, where these immigration terms
// matched the corpus's I-360 document regardless of the email's actual
// topic).
const FIXED_QUERIES: readonly string[] = [
  "I-797",
  "I-360",
  "I-765",
  "employment authorization",
  "special immigrant juvenile",
  "deferred action",
  "approval notice",
];

// generateSearchQueries expands the email intent into multiple FTS-friendly
// queries covering BOTH the email's surface language AND the technical
// vocabulary that appears in actual USCIS/immigration documents.
// This bridges the gap between "proof of lawful presence" in an enrollment
// email and "special immigrant juvenile" / "SIJS" / "EAD" in the documents.
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
        content: `Generate 6-8 short search queries to find relevant USCIS/immigration documents for this email.
Include queries for BOTH what the email asks for AND the technical terms that appear in actual USCIS documents.

Example — if an email asks for "proof of citizenship or lawful presence", good queries include:
"lawful presence", "special immigrant juvenile", "SIJS", "employment authorization", "EAD", "I-360", "I-765", "deferred action", "permanent resident", "work authorization"

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

async function gatherDocuments(llmQueries: string[]): Promise<DocRef[]> {
  // Merge fixed + LLM queries, deduplicated. A query string independently
  // produced by the LLM (even if it happens to match a fixed one verbatim)
  // is tagged "llm" — the LLM generating it FROM the email's actual content
  // is itself a relevance signal that a hardcoded fixed query never carries.
  const llmQuerySet = new Set(llmQueries);
  const allQueries = [...new Set([...FIXED_QUERIES, ...llmQueries])];
  console.log(
    `[handle_email] ${allQueries.length} queries total` +
      ` (${FIXED_QUERIES.length} fixed + ${llmQueries.length} from LLM):`,
    allQueries
  );

  // Run all queries in parallel; limit per query so the total set stays manageable.
  const perQueryResults: QueryResult[] = await Promise.all(
    allQueries.map(async (q): Promise<QueryResult> => {
      const origin = llmQuerySet.has(q) ? "llm" : "fixed";
      try {
        const { hits } = await search(q, 8);
        console.log(
          `[handle_email] query "${q}" (${origin}) → ${hits.length} hit(s):`,
          hits.map((h) => `${h.title} p.${h.page_number} doc_id=${h.doc_id} score=${h.score}`)
        );
        return { query: q, origin, hits };
      } catch (err) {
        console.warn(`[handle_email] search error for query "${q}":`, err);
        return { query: q, origin, hits: [] };
      }
    })
  );

  // Log every raw hit before filtering so we can see exactly what came back.
  const allRawHits = perQueryResults.flatMap((r) => r.hits);
  console.log(
    `[handle_email] ${allRawHits.length} raw hit(s) before relevance filtering:`,
    allRawHits.map((h) => `doc_id=${h.doc_id} title="${h.title}" p=${h.page_number} score=${h.score}`)
  );

  // Score threshold + "found by at least one LLM-generated (email-derived)
  // query" requirement — see selectRelevantDocuments in
  // ./handle_email_grounding for the full rationale. A document found ONLY
  // via fixed queries is dropped here, not merely deprioritized.
  const merged = selectRelevantDocuments(perQueryResults);

  console.log(
    `[handle_email] ${merged.length} relevant document(s) after filtering:`,
    merged.map((d) => `${d.title} p.${d.page}`)
  );
  return merged;
}

async function draftEmailReply(
  client: Anthropic,
  emailText: string,
  sender: string,
  subject: string,
  docs: DocRef[],
  provenance: EmailBodyProvenance | undefined
): Promise<string> {
  // Build the grounding block — the ONLY source of facts the draft may use
  // about the user. When zero documents are relevant, this explicitly says
  // so rather than the model silently having nothing and improvising.
  const groundingBlock = buildGroundingBlock(docs);

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
    "Triages a pasted email, searches your documents for relevant context, and drafts a proposed reply in your voice. Returns a structured proposal you must approve before anything happens — never sends automatically. email_text should be the COMPLETE message body — if you only have a Gmail preview snippet, call read_gmail_message first to get the full text before calling this.",
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
    const { classification, reason } = await triageEmail(client, emailText, sender, subject, bodyProvenance);

    // GATHER & DRAFT (only when actionable)
    let matchedDocs: DocRef[] = [];
    let draftReply: string | null = null;

    if (classification === "actionable") {
      ctx.onStatus?.("Translate language");
      const llmQueries = await generateSearchQueries(client, emailText, subject);

      ctx.onStatus?.("Search documents");
      matchedDocs = await gatherDocuments(llmQueries);

      ctx.onStatus?.("Draft response");
      draftReply = await draftEmailReply(client, emailText, sender, subject, matchedDocs, bodyProvenance);
    }

    ctx.onStatus?.("Wait for approval");

    // matchedDocs is already deduped by title and relevance-filtered by
    // gatherDocuments/selectRelevantDocuments — these remain the grounding
    // sources shown as citations. The full array was already passed to
    // draftEmailReply for context.
    const dedupedDocs = matchedDocs;

    // Sensitive-document deny-by-default gate for SUGGESTED ATTACHMENTS only
    // — never for citations. A document classified as immigration/legal-
    // status/identity/medical/financial/government is excluded from
    // suggested_attachments/attachment_doc_ids unless the email's own text
    // explicitly mentions that category — the "user has not already supplied
    // it" and "Tacit explains why" conditions from the spec cannot currently
    // be verified here (this tool has no visibility into the source email's
    // own attachments), so this is a necessary-but-not-sufficient, safety-
    // biased gate, not a complete implementation of all three conditions.
    // This is what stops an I-360 approval notice from being suggested as an
    // attachment on a housing-application reply.
    const emailMentionsSensitiveCategory = emailExplicitlyMentionsSensitiveCategory(emailText);
    const attachmentCandidates = dedupedDocs.filter((d) => {
      if (!classifySensitiveDocument(d.title, d.doc_type)) return true;
      return emailMentionsSensitiveCategory;
    });

    // Build the reply subject: prepend "Re: " if not already present.
    const replySubject =
      subject && !/^re:/i.test(subject.trim()) ? `Re: ${subject}` : subject;

    const proposal: EmailProposal = {
      classification,
      reason,
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

    void logOwnerAction("handle_email", { classification, sender, subject });

    // _proposal is extracted by the agent loop before the model sees the result.
    return JSON.stringify({
      status: "proposal_ready",
      classification,
      reason,
      _proposal: proposal,
    });
  },
};
