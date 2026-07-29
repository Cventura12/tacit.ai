// Shared inbox-watch logic — called by both the cron route and the owner trigger.

import { GmailChannel } from "@/lib/relevance/channels/gmail";
import { filterAndKeep } from "@/lib/relevance/filter";
import { readMessageBody } from "@/lib/gmail";
import { handle_email } from "@/lib/tools/owner/handle_email";
import { getDb } from "@/lib/db";
import { sendMessageToOwner } from "@/lib/email";
import type { EmailProposal } from "@/lib/types";

export interface WatchResult {
  fetched: number;
  kept: number;
  new_proposals: number;
}

export async function runInboxWatch(): Promise<WatchResult> {
  const db = getDb();
  const channel = new GmailChannel();

  const messages = await channel.fetchNew();
  const kept = await filterAndKeep(messages);

  console.log(`[inbox-watch] ${messages.length} fetched, ${kept.length} kept after filter`);

  let new_proposals = 0;
  const newSubjects: string[] = [];

  for (const msg of kept) {
    // Skip messages already in pending_proposals
    const { data: existing } = await db
      .from("pending_proposals")
      .select("id")
      .eq("gmail_message_id", msg.id)
      .maybeSingle();

    if (existing) {
      console.log(`[inbox-watch] already processed ${msg.id}`);
      continue;
    }

    // Fetch full body; fall back to snippet if it fails
    let body = msg.body;
    try {
      const full = await readMessageBody(msg.id);
      if (full) body = full;
    } catch (err) {
      console.warn(`[inbox-watch] body fetch failed for ${msg.id}:`, err);
    }

    // Run handle_email to triage, retrieve documents, and draft a reply
    let resultStr: string;
    try {
      resultStr = await handle_email.execute(
        {
          email_text: body,
          sender: msg.from,
          subject: msg.subject,
          gmail_message_id: msg.id,
        },
        { ip: "cron", onStatus: (label) => console.log(`[inbox-watch] ${msg.id}: ${label}`) }
      );
    } catch (err) {
      console.error(`[inbox-watch] handle_email failed for ${msg.id}:`, err);
      continue;
    }

    const result = JSON.parse(resultStr) as { _proposal?: EmailProposal };
    const proposal = result._proposal;

    // "ignore" means spam / automated no-reply — skip storing
    if (!proposal || proposal.classification === "ignore") {
      console.log(`[inbox-watch] skipping ${msg.id} (ignore/no proposal)`);
      continue;
    }

    const { error } = await db.from("pending_proposals").insert({
      gmail_message_id: msg.id,
      sender: msg.from ?? "",
      subject: msg.subject ?? "",
      classification: proposal.classification,
      reason: proposal.reason ?? "",
      draft_body: proposal.draft_reply ?? null,
      grounded_sources: (proposal.matched_documents ?? []) as unknown,
      suggested_attachments: (proposal.suggested_attachments ?? []) as unknown,
      thread_id: proposal.thread_id ?? null,
      in_reply_to_id: proposal.in_reply_to_id ?? null,
    });

    if (error) {
      if (error.code === "23505") {
        console.log(`[inbox-watch] duplicate ${msg.id} — skipped`);
        continue;
      }
      console.error(`[inbox-watch] insert failed for ${msg.id}:`, error);
      continue;
    }

    new_proposals++;
    newSubjects.push(msg.subject ?? "(no subject)");
  }

  // Notify the owner when new proposals are created
  if (new_proposals > 0) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const link = appUrl ? `${appUrl}/inbox` : "your Tacit inbox";
    const list = newSubjects.map((s) => `• ${s}`).join("\n");
    try {
      await sendMessageToOwner({
        message: `${new_proposals} email${new_proposals > 1 ? "s" : ""} ready to review:\n\n${list}\n\n→ ${link}`,
        fromName: "Tacit",
      });
    } catch (err) {
      console.error("[inbox-watch] notification email failed:", err);
    }
  }

  return { fetched: messages.length, kept: kept.length, new_proposals };
}
