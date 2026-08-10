import type { EmailBodyProvenance } from "@/lib/gmail";

// A single step in the retrieval trace panel (one per status event during a run).
export type TraceStep = {
  label: string;
  status: "done" | "active";
};

// ─── Run trace detail ─────────────────────────────────────────────────────────

export interface RetrievalTrace {
  id: string;
  doc_id: string;
  doc_title: string;
  page_number: number;
  score: number;
  returned: boolean;
}

export interface ToolRunDetail {
  id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output_summary: string;
  duration_ms: number;
  success: boolean;
  error: string | null;
  sequence: number;
  retrieval_traces: RetrievalTrace[];
}

export interface RunDetail {
  id: string;
  user_query: string;
  duration_ms: number;
  tool_count: number;
  error: string | null;
  created_at: string;
  tool_runs: ToolRunDetail[];
}

// An entry in the sidebar "recent runs" list.
export type RecentRun = {
  id: string;
  label: string;
  relativeTime: string;
  isCurrent?: boolean;
};

// Structured proposal returned by the handle_email tool.
export interface EmailProposal {
  classification: "actionable" | "needs_caleb" | "ignore";
  reason: string;
  // Independent of classification: whether a reply EMAIL is the right
  // response. An "actionable" email can have reply_required: false when the
  // real required action happens elsewhere (a portal, a payment page, in
  // person) — a reply wouldn't accomplish anything. Meaningful only when
  // classification is "actionable."
  //
  // From the live handle_email path this is always true or false (true by
  // default on parse failure, so a reply still gets drafted when this can't
  // be determined — never silently skipped). null is reserved for stored
  // pending_proposals rows that predate the reply_required column
  // (migrations-12-pending-proposals-reply-required.sql) — legacy/unknown,
  // never coerced to true or false on read. See app/inbox/view.tsx.
  reply_required: boolean | null;
  matched_documents: { doc_id?: string; title: string; page: number; snippet: string; highlight?: string }[];
  draft_reply: string | null;
  suggested_attachments: string[];
  // Send envelope — populated by handle_email from the original email's headers.
  recipient?: string;          // "To" address for the reply (original sender)
  reply_subject?: string;      // "Re: " + original subject
  thread_id?: string;          // Gmail threadId for correct threading
  in_reply_to_id?: string;     // Gmail messageId for In-Reply-To header
  attachment_doc_ids?: string[]; // Supabase doc UUIDs matching suggested_attachments[]
  needs_approval: true;
  // Completeness of the email_text handle_email actually triaged/drafted from
  // (see lib/gmail.ts EmailBodyProvenance) — undefined only when the caller
  // supplied no provenance (interactive/legacy path). Never fabricated as
  // "full" when absent; a null/undefined value here means unknown, not full.
  body_provenance?: EmailBodyProvenance;
}

// UI message — what the thread renders
export type Message = {
  id: string;
  role: "me" | "them";
  text: string;
  isError?: boolean; // error bubbles are shown in UI but never sent to the API
  runId?: string;    // agent_runs id for tracing tool calls on this turn
  proposal?: EmailProposal; // rendered as a card below the text bubble
};

// Wire format — what /api/chat expects
export type ApiMessage = {
  role: "user" | "assistant";
  content: string;
};

// Server-sent events streamed from /api/chat
export type StreamEvent =
  | { type: "status"; label: string }        // tool is running — show inline status
  | { type: "run_id"; id: string }           // agent_runs row id — arrives before text
  | { type: "proposal"; data: EmailProposal } // email proposal card — arrives before text
  | { type: "text"; content: string }        // final answer from model
  | { type: "error"; message: string };      // graceful failure
