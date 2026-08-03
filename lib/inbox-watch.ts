// Shared inbox-watch logic — called by both the cron route and the owner trigger.

import { GmailChannel } from "@/lib/relevance/channels/gmail";
import { relevanceFilter } from "@/lib/relevance/filter";
import { readMessageBody, toBodyProvenance, provenanceToInsertFields } from "@/lib/gmail";
import { handle_email } from "@/lib/tools/owner/handle_email";
import { getDb } from "@/lib/db";
import { sendMessageToOwner } from "@/lib/email";
import { logFilterRejection, logProposalEvent, expireOverdueT002Proposals } from "@/lib/t002";
import { resolveReplyRequiredForInsert } from "@/lib/email-proposal";
import type { EmailProposal } from "@/lib/types";

export interface WatchResult {
  fetched: number;
  kept: number;
  new_proposals: number;
  // Count of instrumentation writes (notification_attempted_at/accepted_at
  // columns or their proposal_events rows) that failed this run. This never
  // reflects whether Resend accepted the notification — that's determined solely
  // by sendResult.accepted, independent of whether these writes succeeded. A
  // non-zero count means T-002 lifecycle data for this run's proposals may be
  // incomplete even though the underlying notification/proposal-creation logic
  // itself worked.
  instrumentation_errors: number;
}

export async function runInboxWatch(): Promise<WatchResult> {
  const db = getDb();
  const channel = new GmailChannel();

  const messages = await channel.fetchNew();

  // Both "detected" and "passed the relevance filter" happen within this one
  // filtering pass over the batch — there is no earlier real "detected" moment to
  // record separately from "filtered" for kept messages, so both timestamps share
  // this single real capture. Documented in docs/experiments/T-002.md.
  const filterTimestamp = new Date().toISOString();
  const filtered = await relevanceFilter(messages);
  const dropped = filtered.filter((f) => f.verdict === "dropped");
  const kept = filtered.filter((f) => f.verdict === "kept").map((f) => f.message);

  console.log(`[inbox-watch] ${messages.length} fetched, ${kept.length} kept after filter`);

  // Forward-only audit of what the relevance filter rejected — never body/subject,
  // just enough to manually spot-check for false negatives later.
  await Promise.all(dropped.map((f) => logFilterRejection(db, f.message)));

  let new_proposals = 0;
  const newSubjects: string[] = [];
  const newProposalIds: string[] = [];

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

    // Fetch the full body. readMessageBody() never throws — it handles its own
    // fetch/parse failures and falls back to msg.body (the Gmail snippet)
    // internally, returning a structured completeness result (see
    // lib/gmail.ts). Only .text is consumed here; the completeness/error/
    // attachment fields are logged by readMessageBody itself (safe fields
    // only) and are not persisted anywhere in this pass — proposal storage is
    // out of scope here.
    const bodyResult = await readMessageBody(msg.id, msg.body);
    if (bodyResult.content_completeness !== "full") {
      console.warn(
        `[inbox-watch] body completeness=${bodyResult.content_completeness} for ${msg.id} ` +
          `(parts_failed=${bodyResult.parts_failed}, codes=${bodyResult.error_codes.join(",")})`
      );
    }
    const body = bodyResult.text;

    // Run handle_email to triage, retrieve documents, and draft a reply.
    // Provenance travels via ctx.emailBodyProvenance — a trusted execution-
    // context field, not a model-controlled input — because this is a direct
    // in-process TypeScript call, not a model tool-call. It's the SAME
    // MessageBodyResult that produced `body` above, never re-derived or
    // re-classified. If retrieval failed and `body` ended up being the
    // relevance-filter snippet (or empty), that truthful state
    // (snippet_only/fetch_failed) travels with it rather than silently
    // presenting it as a full body.
    let resultStr: string;
    try {
      resultStr = await handle_email.execute(
        {
          email_text: body,
          sender: msg.from,
          subject: msg.subject,
          gmail_message_id: msg.id,
        },
        {
          ip: "cron",
          onStatus: (label) => console.log(`[inbox-watch] ${msg.id}: ${label}`),
          emailBodyProvenance: toBodyProvenance(bodyResult),
        }
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

    // Provenance is written from proposal.body_provenance — the exact
    // MessageBodyResult (via email_body_provenance above) that handle_email
    // actually triaged/drafted from — never re-derived here. A proposal is
    // only ever marked "full" if that's genuinely what came back; absent
    // provenance (shouldn't happen on this path, but see
    // provenanceToInsertFields) writes null in every column, not "full".
    const { data: inserted, error } = await db
      .from("pending_proposals")
      .insert({
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
        source_received_at: msg.receivedAt ?? null,
        source_received_at_inferred: msg.receivedAtInferred ?? null,
        detected_at: filterTimestamp,
        filtered_at: filterTimestamp,
        proposal_created_at: new Date().toISOString(),
        // Written explicitly from this same handle_email result — never
        // re-derived, never defaulted to true just because the proposal is
        // "actionable." See resolveReplyRequiredForInsert for the
        // malformed/missing-value fallback (null, not a fabricated default).
        reply_required: resolveReplyRequiredForInsert(proposal.reply_required),
        ...provenanceToInsertFields(proposal.body_provenance),
      })
      .select("id")
      .single();

    if (error || !inserted) {
      if (error?.code === "23505") {
        console.log(`[inbox-watch] duplicate ${msg.id} — skipped`);
        continue;
      }
      console.error(`[inbox-watch] insert failed for ${msg.id}:`, error);
      continue;
    }

    new_proposals++;
    newSubjects.push(msg.subject ?? "(no subject)");
    newProposalIds.push(inserted.id);

    await logProposalEvent(db, inserted.id, "detected");
    await logProposalEvent(db, inserted.id, "passed_filter");
    await logProposalEvent(db, inserted.id, "proposal_created");

    // Attempt T-002 enrollment — best-effort, silently no-ops once the locked cap
    // is reached. Eligibility (not a duplicate, not "ignore") was already enforced
    // above by reaching this point.
    const { error: enrollErr } = await db.rpc("t002_try_enroll", { p_proposal_id: inserted.id });
    if (enrollErr) {
      console.warn(`[inbox-watch] t002 enrollment check failed for ${inserted.id}:`, enrollErr);
    }
  }

  // Notify the owner when new proposals are created
  let instrumentationErrors = 0;

  if (new_proposals > 0) {
    const notificationAttemptedAt = new Date().toISOString();

    const { error: attemptedUpdateErr } = await db
      .from("pending_proposals")
      .update({ notification_attempted_at: notificationAttemptedAt })
      .in("id", newProposalIds);
    if (attemptedUpdateErr) {
      instrumentationErrors++;
      // Log the count and the error only — never message content (subjects live
      // in `newSubjects`, deliberately not referenced here).
      console.error(
        `[inbox-watch] notification_attempted_at write failed for ${newProposalIds.length} proposal(s):`,
        attemptedUpdateErr.message
      );
    }

    const { error: attemptedEventErr } = await db.from("proposal_events").insert(
      newProposalIds.map((id) => ({ proposal_id: id, event_type: "notification_attempted" as const }))
    );
    if (attemptedEventErr) {
      instrumentationErrors++;
      console.error(
        `[inbox-watch] notification_attempted event insert failed for ${newProposalIds.length} proposal(s):`,
        attemptedEventErr.message
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const link = appUrl ? `${appUrl}/inbox` : "your Tacit inbox";
    const list = newSubjects.map((s) => `• ${s}`).join("\n");
    try {
      const sendResult = await sendMessageToOwner({
        message: `${new_proposals} email${new_proposals > 1 ? "s" : ""} ready to review:\n\n${list}\n\n→ ${link}`,
        fromName: "Tacit",
      });

      // Resend's response only confirms it ACCEPTED the send request — never that
      // the owner actually received it. See lib/email.ts. Whether we successfully
      // *recorded* that acceptance below is a separate concern from whether it
      // was accepted — a DB write failure here must never be read backwards into
      // "Resend didn't accept it," and a write failure must never be silently
      // treated as if it succeeded.
      if (sendResult.accepted) {
        const notificationAcceptedAt = new Date().toISOString();

        const { error: acceptedUpdateErr } = await db
          .from("pending_proposals")
          .update({ notification_accepted_at: notificationAcceptedAt })
          .in("id", newProposalIds);
        if (acceptedUpdateErr) {
          instrumentationErrors++;
          console.error(
            `[inbox-watch] notification_accepted_at write failed for ${newProposalIds.length} proposal(s):`,
            acceptedUpdateErr.message
          );
        }

        const { error: acceptedEventErr } = await db.from("proposal_events").insert(
          newProposalIds.map((id) => ({ proposal_id: id, event_type: "notification_accepted" as const }))
        );
        if (acceptedEventErr) {
          instrumentationErrors++;
          console.error(
            `[inbox-watch] notification_accepted event insert failed for ${newProposalIds.length} proposal(s):`,
            acceptedEventErr.message
          );
        }
      }
    } catch (err) {
      console.error("[inbox-watch] notification email failed:", err);
    }
  }

  await expireOverdueT002Proposals(db);

  return {
    fetched: messages.length,
    kept: kept.length,
    new_proposals,
    instrumentation_errors: instrumentationErrors,
  };
}
