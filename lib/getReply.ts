import type { ApiMessage, StreamEvent, EmailProposal } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ReplyMeta {
  sessionId?: string;
  gateAnswer?: string;
}

export interface ReplyResult {
  text: string;
  runId: string | undefined;
  proposal?: EmailProposal;
}

// Consumes the SSE stream from /api/chat.
// Calls onStatus whenever the server emits a "status" event (tool running).
// Returns the model's final text reply and the agent_runs id for tracing.
// Throws ApiError on HTTP errors or stream-level failures.
export async function getReply(
  messages: ApiMessage[],
  onStatus?: (label: string) => void,
  meta?: ReplyMeta
): Promise<ReplyResult> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, ...meta }),
    });
  } catch {
    throw new ApiError(0, "Network error");
  }

  if (!res.ok) {
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiError(0, "No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let runId: string | undefined;
  let proposal: EmailProposal | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(line.slice(6)) as StreamEvent;
      } catch {
        continue;
      }

      if (event.type === "status") {
        onStatus?.(event.label);
      } else if (event.type === "run_id") {
        runId = event.id;
      } else if (event.type === "proposal") {
        proposal = event.data;
      } else if (event.type === "text") {
        return { text: event.content, runId, proposal };
      } else if (event.type === "error") {
        throw new ApiError(500, event.message);
      }
    }
  }

  throw new ApiError(0, "Stream ended without a reply");
}
