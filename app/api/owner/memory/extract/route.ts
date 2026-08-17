import { type NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { extractPastedCandidates, MAX_PASTE_LEN } from "@/lib/memory/extract_pasted";

// PASTE-MODE MEMORY EXTRACTION — memory Phase 2. Proposes candidate memories
// from pasted text; nothing becomes a real memory here. Every candidate
// writes as memory_type='inferred_candidate' (unconfirmed) via the existing
// write path (lib/memory/store.ts's writeMemory) — the same store, the same
// guarantees, the same confirm/reject step every other candidate memory
// already goes through. Confirming or rejecting happens at
// POST /api/owner/memory/resolve, a separate route (not an action field on
// this one) — matching this codebase's existing one-route-one-job
// convention rather than inventing an action-dispatch shape.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await requireOwner();
  if (!check.ok) return check.response;

  // owner_id comes from the authenticated session ONLY. A client-supplied
  // owner_id in the request body, if any, is never read.
  const ownerId = check.userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { text, label } = (body ?? {}) as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_PASTE_LEN) {
    return NextResponse.json({ error: `text must be ${MAX_PASTE_LEN} characters or fewer` }, { status: 400 });
  }
  if (label !== undefined && typeof label !== "string") {
    return NextResponse.json({ error: "label must be a string" }, { status: 400 });
  }

  try {
    const result = await extractPastedCandidates({
      ownerId,
      text: text.trim(),
      label: typeof label === "string" ? label.trim() || undefined : undefined,
    });

    // Counts/ids only — the pasted text and every extracted claim/reason/
    // excerpt must never reach logs.
    console.log(
      `[memory/extract] source_id=${result.source_id} candidates=${result.candidates.length} already_known=${result.already_known.length}`
    );

    return NextResponse.json(result);
  } catch (err) {
    // Never log err.message here: a thrown error from extraction could in
    // principle echo back part of the pasted text (mirroring the same risk
    // already documented in app/api/owner/ask/route.ts for search()'s error
    // messages). Log the error TYPE only.
    console.error("[memory/extract] extraction failed:", err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ error: "Something went wrong extracting candidates." }, { status: 500 });
  }
}
