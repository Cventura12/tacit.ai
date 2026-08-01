// Pure client-side decision logic for the /inbox page, extracted so the
// send/skip response-handling behavior is unit-testable without a React
// testing harness (none exists in this repo).

export interface MarkStatusOutcome {
  shouldRemove: boolean;
  shouldReload: boolean;
  errorMessage: string | null;
}

// Given the PATCH /api/owner/inbox/[id] response, decide what the UI should do.
// A non-ok response must never remove the proposal from the local list — that
// would make the UI claim the action succeeded when it didn't. A 409 specifically
// means the server-side row is no longer 'pending' (already transitioned, or lost
// a race against expiration), so the list is reloaded to reflect the real state
// rather than trusting local optimism.
export function decideMarkStatusOutcome(
  ok: boolean,
  status: number,
  body: { error?: string; code?: string } | null
): MarkStatusOutcome {
  if (ok) {
    return { shouldRemove: true, shouldReload: false, errorMessage: null };
  }
  if (status === 409) {
    return {
      shouldRemove: false,
      shouldReload: true,
      errorMessage: body?.error ?? "This proposal is no longer pending.",
    };
  }
  return {
    shouldRemove: false,
    shouldReload: false,
    errorMessage: body?.error ?? "Failed to update proposal.",
  };
}
