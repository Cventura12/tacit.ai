// Main pipeline: Stage 1 (coarse) → Stage 2 (smart, only for uncertain messages).
// Returns all messages tagged with verdict + reason so the caller can log and tune.

import type { Message, FilteredMessage } from "./types";
import { coarseFilter } from "./coarse";
import { smartTriage } from "./smart";
import { SMART_CONCURRENCY } from "./config";

export async function relevanceFilter(messages: Message[]): Promise<FilteredMessage[]> {
  const results: FilteredMessage[] = [];
  const uncertain: Array<{ msg: Message; index: number }> = [];

  // ── Stage 1: coarse filter (synchronous, free) ────────────────────────────
  for (const msg of messages) {
    const outcome = coarseFilter(msg);

    if (outcome.decision === "drop") {
      results.push({ message: msg, verdict: "dropped", stage: "coarse", reason: outcome.reason });
      log("coarse:drop", msg, outcome.reason);
    } else if (outcome.decision === "keep") {
      results.push({ message: msg, verdict: "kept", stage: "coarse", reason: outcome.reason });
      log("coarse:keep", msg, outcome.reason);
    } else {
      // uncertain — queue for stage 2; placeholder will be filled below
      uncertain.push({ msg, index: results.length });
      results.push(null as unknown as FilteredMessage); // filled after stage 2
    }
  }

  if (uncertain.length === 0) return results;

  // ── Stage 2: smart triage (AI, capped concurrency) ───────────────────────
  console.log(`[relevance] stage 2: ${uncertain.length} uncertain message(s)`);

  // Process in batches to respect concurrency limit.
  for (let i = 0; i < uncertain.length; i += SMART_CONCURRENCY) {
    const batch = uncertain.slice(i, i + SMART_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ msg, index }) => {
        const { relevant, score, reason } = await smartTriage(msg);
        const verdict = relevant ? "kept" : "dropped";
        const fm: FilteredMessage = {
          message: msg,
          verdict,
          stage: "smart",
          reason: `ai:${relevant ? "relevant" : "irrelevant"}:${reason}`,
          score,
        };
        results[index] = fm;
        log(`smart:${verdict}`, msg, `score=${score.toFixed(2)} ${reason}`);
      })
    );
  }

  return results;
}

// Convenience: only the kept messages, ready to hand to handle_email.
export async function filterAndKeep(messages: Message[]): Promise<Message[]> {
  const results = await relevanceFilter(messages);
  return results.filter((r) => r.verdict === "kept").map((r) => r.message);
}

// Non-content fields only — never msg.from/subject/body. msg.id is the
// channel-native (e.g. Gmail) message ID, an opaque identifier safe to log;
// it carries no email content itself.
function log(label: string, msg: Message, reason: string) {
  console.log(`[relevance] ${label.padEnd(14)} | id=${msg.id} | ${reason}`);
}
