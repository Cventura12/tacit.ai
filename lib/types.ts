// A single step in the retrieval trace panel (one per status event during a run).
export type TraceStep = {
  label: string;
  status: "done" | "active";
};

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
  matched_documents: { doc_id?: string; title: string; page: number; snippet: string; highlight?: string }[];
  draft_reply: string | null;
  suggested_attachments: string[];
  needs_approval: true;
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
