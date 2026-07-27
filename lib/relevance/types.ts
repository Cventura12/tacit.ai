// Channel-agnostic message shape.  Any channel (Gmail, SMS, …) maps its
// native format to this before entering the filter pipeline.
export interface Message {
  source: "gmail" | string; // channel that produced this message
  id: string;               // channel-native message ID
  from: string;             // full From value, e.g. "Jane <jane@example.com>"
  subject: string;
  body: string;             // snippet or full body — sufficient for triage
  receivedAt: string;       // ISO 8601
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
