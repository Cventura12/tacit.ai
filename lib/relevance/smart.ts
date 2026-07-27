// Stage-2 AI triage — only runs on messages that survived stage 1 with
// outcome "uncertain".  Uses Haiku for cheapness (binary classification only).

import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "./types";
import { SMART_THRESHOLD } from "./config";

export interface SmartResult {
  relevant: boolean;
  score: number;   // 0.0–1.0
  reason: string;  // one-sentence explanation
}

const CLIENT = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function smartTriage(msg: Message): Promise<SmartResult> {
  let raw: string;
  try {
    const res = await CLIENT.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: `You are deciding whether an incoming email is worth routing to an immigration/enrollment assistant.

Score it 0.0–1.0 for relevance to:
- Immigration status, USCIS filings, lawful presence, work authorization, EAD, SIJS, deferred action
- School enrollment, financial aid, residency verification, academic documents
- Any official notice or substantive question that requires a real reply

Score close to 1.0 for direct hits on the above; 0.5 for related but not squarely in domain; below 0.3 for unrelated; 0.0 for clear noise/spam.

Email:
From: ${msg.from}
Subject: ${msg.subject}
Snippet: ${msg.body.slice(0, 400)}

Return JSON only, no markdown: {"score":0.0,"reason":"one sentence"}`,
        },
      ],
    });

    raw = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  } catch (err) {
    console.warn("[relevance/smart] API error — defaulting to keep:", err);
    // On API failure, keep the message so we never silently drop it.
    return { relevant: true, score: 0.5, reason: "api-error: defaulting to keep" };
  }

  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as { score?: unknown; reason?: unknown };
    const score = typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : 0.5;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "ai-classified";
    return { relevant: score >= SMART_THRESHOLD, score, reason };
  } catch {
    // Parse failure — keep the message to avoid silent drops.
    return { relevant: true, score: 0.5, reason: "parse-error: defaulting to keep" };
  }
}
