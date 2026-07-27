// Manual relevance check — fetches the current inbox, runs the full filter
// pipeline, and returns a structured report of what was kept vs. dropped.
// POST body (all optional): { query?: string; max?: number }
// Returns: { kept: FilteredMessage[]; dropped: FilteredMessage[]; stats }

import { type NextRequest, NextResponse } from "next/server";
import { GmailChannel } from "@/lib/relevance/channels/gmail";
import { relevanceFilter } from "@/lib/relevance/filter";
import type { FilteredMessage } from "@/lib/relevance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shape(r: FilteredMessage) {
  return {
    id:         r.message.id,
    source:     r.message.source,
    from:       r.message.from,
    subject:    r.message.subject,
    receivedAt: r.message.receivedAt,
    verdict:    r.verdict,
    stage:      r.stage,
    reason:     r.reason,
    score:      r.score,
  };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // No body is fine — all fields optional.
  }

  const query = typeof body.query === "string" ? body.query : undefined;
  const max   = typeof body.max   === "number" ? Math.min(body.max, 25) : undefined;

  const channel = new GmailChannel(query, max);

  let messages: Awaited<ReturnType<GmailChannel["fetchNew"]>>;
  try {
    messages = await channel.fetchNew();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to fetch inbox: ${msg}` }, { status: 502 });
  }

  if (messages.length === 0) {
    return NextResponse.json({
      kept: [], dropped: [],
      stats: { total: 0, kept: 0, dropped: 0, coarse_kept: 0, coarse_dropped: 0, smart_kept: 0, smart_dropped: 0 },
    });
  }

  let results: FilteredMessage[];
  try {
    results = await relevanceFilter(messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Filter pipeline failed: ${msg}` }, { status: 500 });
  }

  const kept    = results.filter((r) => r.verdict === "kept");
  const dropped = results.filter((r) => r.verdict === "dropped");

  const stats = {
    total:          results.length,
    kept:           kept.length,
    dropped:        dropped.length,
    coarse_kept:    kept.filter((r)    => r.stage === "coarse").length,
    coarse_dropped: dropped.filter((r) => r.stage === "coarse").length,
    smart_kept:     kept.filter((r)    => r.stage === "smart").length,
    smart_dropped:  dropped.filter((r) => r.stage === "smart").length,
  };

  console.log("[relevance/check]", JSON.stringify(stats));

  return NextResponse.json({
    kept:    kept.map(shape),
    dropped: dropped.map(shape),
    stats,
  });
}
