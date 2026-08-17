import { type NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { answerQuestion } from "@/lib/ask";

// GROUNDED QUESTION SURFACE — Phase 1 of Tacit's shift from "email handler"
// to "founder's sparring partner": a place to ask questions, grounded in the
// owner's documents and remembered facts, refusing rather than guessing when
// the corpus doesn't cover it. This is intentionally a SEPARATE route from
// the persona chat (app/api/chat/route.ts), not an extension of it: that
// route runs a free-form, multi-tool agent loop (all 18 registry tools,
// including side-effecting ones like toggle_connector) and streams SSE. A
// question must never be able to trigger a side effect — this route gives
// the model NO tool-call surface at all, only a fixed, auditable
// retrieve→ground→answer turn (see lib/ask.ts), and plain JSON in/out.
//
// SINGLE-TURN ONLY in this phase — no conversation history. This is a
// recorded decision, not an oversight: accumulating/remembering across
// turns is a later phase. No history parameter exists here on purpose; do
// not add one speculatively.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LEN = 2000;

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

  const { question } = (body ?? {}) as Record<string, unknown>;
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LEN) {
    return NextResponse.json(
      { error: `question must be ${MAX_QUESTION_LEN} characters or fewer` },
      { status: 400 }
    );
  }

  try {
    const { outcome, citations } = await answerQuestion(ownerId, question.trim());

    // Length only — question/answer text must never reach logs.
    console.log(`[ask] outcome=${outcome.kind} citations=${citations.length} question_length=${question.length}`);

    if (outcome.kind === "answered") {
      return NextResponse.json({ status: "answered", answer: outcome.answer, citations });
    }

    if (outcome.kind === "refused") {
      // A refusal is the system working correctly — recognized insufficient
      // grounding and stopped rather than guessing. Always 200, never an
      // error status, so it can never be confused with a failure.
      return NextResponse.json({ status: "refused", answer: null, reason: outcome.reason, citations: [] });
    }

    // outcome.kind === "error" — the model produced no usable decision at
    // all (unparseable or structurally invalid output). outcome.message is
    // always one of a small set of fixed strings from classifyAskOutcome —
    // never raw model output — so it's safe to log as-is.
    console.error(`[ask] model produced no usable decision: ${outcome.message}`);
    return NextResponse.json({ error: "Could not produce a grounded answer." }, { status: 500 });
  } catch (err) {
    // Never log err.message: lib/documents.ts's search() embeds the raw
    // query (which may be the owner's question, verbatim) in its own thrown
    // error message, and that error can propagate here unchanged from
    // lib/ask.ts. Log the error TYPE only.
    console.error("[ask] retrieval or model failure:", err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ error: "Something went wrong answering that." }, { status: 500 });
  }
}
