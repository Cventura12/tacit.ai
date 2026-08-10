// Channel-agnostic message shape.  Any channel (Gmail, SMS, …) maps its
// native format to this before entering the filter pipeline.
export interface Message {
  source: "gmail" | string; // channel that produced this message
  id: string;               // channel-native message ID
  from: string;             // full From value, e.g. "Jane <jane@example.com>"
  subject: string;
  // The Gmail snippet ONLY, for this cheap pre-filter stage — intentional and
  // documented (see docs/experiments/T-002.md). Do not confuse this with the
  // full body handle_email actually triages/drafts from: that's fetched
  // separately, post-filter, in lib/inbox-watch.ts via readMessageBody(), and
  // carries its own completeness provenance (see lib/gmail.ts
  // EmailBodyProvenance) — never reuse this snippet-only field as if it were
  // that later, more complete body.
  body: string;
  receivedAt: string;       // ISO 8601
  // True when receivedAt fell back to processing time because the channel had no
  // genuine source-received timestamp (e.g. a missing Gmail Date header) — see
  // GmailChannel.fetchNew(). Rows built from an inferred receivedAt must be
  // excluded from "total system latency" analysis; see docs/experiments/T-002.md.
  receivedAtInferred: boolean;
  raw?: Record<string, unknown>; // original channel payload, passed through untouched
}

// Any channel implements this interface; the pipeline stays channel-agnostic.
export interface Channel {
  name: string;
  fetchNew(): Promise<Message[]>;
}

// Verdict for a single message through the pipeline.
export interface FilteredMessage {
  message: Message;
  verdict: "kept" | "dropped";
  // Which stage made the final call.
  stage: "coarse" | "smart";
  reason: string;   // human-readable: "allowlist:domain:uscis.gov", "ai:irrelevant", …
  score?: number;   // 0–1, only present when stage === "smart"
}
