// Pure, dependency-free helpers for EmailProposal, shared by the display
// components (components/EmailProposalCard.tsx, components/MessageBubble.tsx)
// and the automated write path (lib/inbox-watch.ts). Kept framework-free (no
// React import, no @/-aliased import) so it's directly testable with Node's
// native test runner.

// Defensive against stale, null, or malformed grounded-source data — never
// trust `matched_documents` as a well-formed, meaningful array just because
// its TYPE declares one. Runtime data (deserialized JSON, an older cached
// object, a manually-constructed test fixture) isn't guaranteed to match. An
// entry counts as a genuine source only when it carries a non-empty title —
// this is what "Every claim traces to a cited page" is allowed to depend on;
// getting it wrong is how that text could show up with zero real sources.
export function countGenuineSources(matchedDocuments: unknown): number {
  if (!Array.isArray(matchedDocuments)) return 0;
  return matchedDocuments.filter(isGenuineSource).length;
}

function isGenuineSource(d: unknown): d is { title: string } {
  if (!d || typeof d !== "object") return false;
  const title = (d as { title?: unknown }).title;
  return typeof title === "string" && title.trim().length > 0;
}

// Used by lib/inbox-watch.ts when inserting a new pending_proposals row.
// Passes through a genuine true/false unchanged — including false, which
// must never be silently upgraded to true just because the proposal is
// "actionable" — and writes null (legacy/unknown) for anything else
// (missing, or a malformed non-boolean value), rather than fabricating
// certainty a live triage call never actually produced.
export function resolveReplyRequiredForInsert(replyRequired: unknown): boolean | null {
  return typeof replyRequired === "boolean" ? replyRequired : null;
}
