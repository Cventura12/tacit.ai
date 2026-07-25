import type { ToolDefinition } from "../registry";
import type { EmailProposal } from "@/lib/types";
import { logOwnerAction } from "@/lib/owner-actions";
import { search } from "@/lib/documents";
import Anthropic from "@anthropic-ai/sdk";

// ─── Internal reasoning steps ─────────────────────────────────────────────────

async function triageEmail(
  client: Anthropic,
  emailText: string,
  sender: string,
  subject: string
): Promise<{ classification: EmailProposal["classification"]; reason: string }> {
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages: [
      {
        role: "user",
        content: `You are triaging email for Caleb Ventura. His files include USCIS immigration documents (I-360 SIJS approval, I-765 Employment Authorization), enrollment paperwork, and related notices.

Classify as "actionable" when the email:
- Requests documents he may already have (proof of lawful presence, work authorization, EAD, USCIS notices, enrollment records, identity documents)
- Asks a question answerable by referencing his documents
- Needs a reply but no binding commitment from him

Classify as "needs_caleb" ONLY when the email:
- Requires him to accept or decline an offer
- Involves signing something, paying money, or making a legal commitment
- Asks for a personal decision or opinion only he can give

Classify as "ignore" when:
- Spam, marketing, automated notification, no reply needed

CRITICAL: Emails touching immigration status, lawful presence, or work authorization are ACTIONABLE — they can be answered by searching his documents. Do NOT classify them as "needs_caleb" just because the topic is sensitive. The draft step enforces never-assert-without-document; triage only decides whether to act.

Email:
From: ${sender || "(unknown)"}
Subject: ${subject || "(no subject)"}
Body: ${emailText.slice(0, 1200)}

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

// DocRef carries the actual retrieved excerpt so the draft is grounded in
// document text, not inferred from the email's wording.
type DocRef = { doc_id: string; title: string; page: number; snippet: string; highlight: string };

// Fixed queries that run on EVERY handle_email call regardless of what the LLM
// generates. Short form-number tokens are OCR-stable and reliably match the
// indexed text even when OCR quality is imperfect.
const FIXED_QUERIES: readonly string[] = [
  "I-797",
  "I-360",
  "I-765",
  "employment authorization",
  "special immigrant juvenile",
  "deferred action",
  "approval notice",
];

// Strip ts_headline markup before passing to the model or storing.
function cleanSnippet(raw: string): string {
  return raw.replace(/<\/?mark>/g, "").replace(/\s+/g, " ").trim();
}

// Extract the text inside <mark>…</mark> tags — the exact matched span for
// PDF highlight. Multiple spans are joined with a space.
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
  // Merge fixed + LLM queries, deduplicated. Fixed queries run first so their
  // hits rank above LLM query hits when scores are equal.
  const allQueries = [...new Set([...FIXED_QUERIES, ...llmQueries])];
  console.log(
    `[handle_email] ${allQueries.length} queries total` +
      ` (${FIXED_QUERIES.length} fixed + ${llmQueries.length} from LLM):`,
    allQueries
  );

  // Run all queries in parallel; limit per query so the total set stays manageable.
  const perQueryHits = await Promise.all(
    allQueries.map(async (q) => {
      try {
        const { hits } = await search(q, 8);
        console.log(
          `[handle_email] query "${q}" → ${hits.length} hit(s):`,
          hits.map((h) => `${h.title} p.${h.page_number} doc_id=${h.doc_id} score=${h.score}`)
        );
        return hits;
      } catch (err) {
        console.warn(`[handle_email] search error for query "${q}":`, err);
        return [];
      }
    })
  );

  // Log every raw hit before merge so we can see exactly what came back.
  const allRawHits = perQueryHits.flat();
  console.log(
    `[handle_email] ${allRawHits.length} raw hit(s) before merge:`,
    allRawHits.map((h) => `doc_id=${h.doc_id} title="${h.title}" p=${h.page_number} score=${h.score}`)
  );

  // Step 1: deduplicate pages — one entry per title:page_number, highest score wins.
  // Keying on title (not doc_id) so this is robust against undefined doc_id from
  // older schema versions. Normalize score to avoid undefined/null comparison bugs.
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

  // Step 2: group by document title — keep only the highest-scored page per document.
  // This guarantees EVERY document that had any hit appears in the result,
  // regardless of how many pages a single high-scoring document matches.
  // Without this, slice(0, 8) on pages lets one multi-page doc fill all slots.
  const byTitle = new Map<string, { ref: DocRef; score: number }>();
  for (const { ref, score } of seenPages.values()) {
    const existing = byTitle.get(ref.title);
    if (!existing || score > existing.score) {
      byTitle.set(ref.title, { ref, score });
    }
  }

  const merged = Array.from(byTitle.values())
    .sort((a, b) => b.score - a.score)
    .map(({ ref }) => ref);

  console.log(
    `[handle_email] ${merged.length} unique document(s) after merge:`,
    merged.map((d) => `${d.title} p.${d.page}`)
  );
  return merged;
}

async function draftEmailReply(
  client: Anthropic,
  emailText: string,
  sender: string,
  subject: string,
  docs: DocRef[]
): Promise<string> {
  // Build the grounding block — the ONLY source of facts the draft may use.
  const groundingBlock =
    docs.length > 0
      ? `RETRIEVED DOCUMENT EXCERPTS — the ONLY facts you may assert about the user:

${docs.map((d) => `[${d.title} · p.${d.page}]\n"${d.snippet}"`).join("\n\n")}`
      : "No matching documents were found. Do not assert any facts about the user.";

  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Draft a reply email for Caleb Ventura based strictly on retrieved document excerpts.

${groundingBlock}

HARD RULES — each is a failure condition if violated:
1. Never state or imply the user's citizenship, immigration status, eligibility, or any personal legal fact unless a retrieved excerpt above explicitly says it word for word.
2. Never infer facts from the email's wording, from what the sender seems to assume, or from general knowledge about immigration law.
3. If the email asks about a fact not present in the retrieved excerpts, write [needs your input: describe what's missing] as a placeholder rather than guessing.
4. If you reference a document, name it exactly as it appears in the headings above and cite the page number.
5. Do not assert that the user "is" or "is not" a citizen, permanent resident, or any status — only quote what the document says.
6. When describing what a document IS, use only the specific form name, type, and classification found in its retrieved excerpt — e.g. "Special Immigrant Juvenile" if the excerpt says that, or "category C14" if the excerpt says that. Never use generic phrases like "approval of a nonimmigrant petition" that don't appear in the retrieved text.

Voice: Caleb's casual, lowercase, direct style. Short sentences. If a document is relevant, say you're attaching it and name it exactly.

Email to reply to:
From: ${sender || "(unknown)"}
Subject: ${subject || "(no subject)"}
Body:
${emailText}

Write only the reply body — no greeting header, no subject line, no sign-off.`,
      },
    ],
  });

  return res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const handle_email: ToolDefinition = {
  name: "handle_email",
  description:
    "Triages a pasted email, searches your documents for relevant context, and drafts a proposed reply in your voice. Returns a structured proposal you must approve before anything happens — never sends automatically.",
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
    },
    required: ["email_text"],
  },
  lane: "owner",
  statusLabel: "reading your email…",
  execute: async (input, ctx) => {
    const emailText = typeof input.email_text === "string" ? input.email_text.trim() : "";
    if (!emailText) return JSON.stringify({ error: "email_text is required" });

    const sender = typeof input.sender === "string" ? input.sender.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // TRIAGE
    ctx.onStatus?.("Triage request");
    const { classification, reason } = await triageEmail(client, emailText, sender, subject);

    // GATHER & DRAFT (only when actionable)
    let matchedDocs: DocRef[] = [];
    let draftReply: string | null = null;

    if (classification === "actionable") {
      ctx.onStatus?.("Translate language");
      const llmQueries = await generateSearchQueries(client, emailText, subject);

      ctx.onStatus?.("Search documents");
      matchedDocs = await gatherDocuments(llmQueries);

      ctx.onStatus?.("Draft response");
      draftReply = await draftEmailReply(client, emailText, sender, subject, matchedDocs);
    }

    ctx.onStatus?.("Wait for approval");

    // Dedupe matched_documents by title — keep the highest-scored page per document
    // (matchedDocs is already sorted score-desc from gatherDocuments, so first wins).
    // The full matchedDocs array was already passed to draftEmailReply for context.
    const seenTitles = new Set<string>();
    const dedupedDocs = matchedDocs.filter((d) => {
      if (seenTitles.has(d.title)) return false;
      seenTitles.add(d.title);
      return true;
    });

    const proposal: EmailProposal = {
      classification,
      reason,
      matched_documents: dedupedDocs,
      draft_reply: draftReply,
      suggested_attachments: [...seenTitles],
      needs_approval: true,
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
