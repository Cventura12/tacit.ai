import { type NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { confirmCandidate, rejectCandidate } from "@/lib/memory/store";

// RESOLVING PASTE-MODE CANDIDATES — memory Phase 2. Confirms/rejects
// inferred_candidate memories (from POST /api/owner/memory/extract, or any
// other future candidate source) via the EXISTING confirmCandidate/
// rejectCandidate functions in lib/memory/store.ts — no raw updates here.
// Confirming does NOT retype memory_type to 'owner_stated'; a confirmed
// candidate stays memory_type='inferred_candidate',
// confirmation_status='confirmed'. That distinction — told directly vs.
// extracted-then-approved — is real provenance, kept deliberately, matching
// existing behavior exactly (see store.ts's setConfirmationStatus).
// Rejecting tombstones (confirmation_status='rejected'); nothing is ever
// hard-deleted.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
}

export async function POST(request: NextRequest) {
  const check = await requireOwner();
  if (!check.ok) return check.response;

  // owner_id comes from the authenticated session ONLY. Every
  // confirmCandidate/rejectCandidate call below is scoped to this id — a
  // candidate belonging to a different owner is indistinguishable from
  // "doesn't exist" (see fetchOwnedMemory in lib/memory/store.ts) and fails
  // with zero side effects.
  const ownerId = check.userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { confirm, reject } = (body ?? {}) as Record<string, unknown>;
  const confirmIds = confirm === undefined ? [] : confirm;
  const rejectIds = reject === undefined ? [] : reject;

  if (!isStringArray(confirmIds) || !isStringArray(rejectIds)) {
    return NextResponse.json({ error: "confirm and reject must be arrays of non-empty ids" }, { status: 400 });
  }
  if (confirmIds.length === 0 && rejectIds.length === 0) {
    return NextResponse.json({ error: "at least one id must be provided in confirm or reject" }, { status: 400 });
  }
  const overlap = confirmIds.filter((id) => rejectIds.includes(id));
  if (overlap.length > 0) {
    return NextResponse.json({ error: "an id cannot appear in both confirm and reject" }, { status: 400 });
  }

  const confirmed: string[] = [];
  const rejected: string[] = [];
  const failed: { id: string; error: string }[] = [];

  // Per-id, independent — one bad id (wrong owner, wrong type, already
  // resolved) must not abort the rest of the batch.
  for (const id of confirmIds) {
    try {
      const memory = await confirmCandidate(id, ownerId);
      confirmed.push(memory.id);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "confirm failed" });
    }
  }
  for (const id of rejectIds) {
    try {
      const memory = await rejectCandidate(id, ownerId);
      rejected.push(memory.id);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "reject failed" });
    }
  }

  // Ids and counts only — confirmCandidate/rejectCandidate's own errors
  // never include claim text (see store.ts), so surfacing err.message here
  // is safe, unlike the raw-question-derived errors in the ask/extract
  // routes.
  console.log(
    `[memory/resolve] confirmed=${confirmed.length} rejected=${rejected.length} failed=${failed.length}`
  );

  return NextResponse.json({ confirmed, rejected, failed });
}
