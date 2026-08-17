import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// app/api/owner/ask/route.ts can't be imported by Node's test runner (it
// pulls in Next.js/@/-aliased modules, and requireOwner() needs a real
// Clerk session that isn't available outside a running server) — these are
// source-text checks proving the wiring is correct, the same established
// pattern already used for app/api/chat/route.ts in
// lib/tools/tool-log-summary.test.ts. The actual retrieval/answer/refusal
// behavior is proven live against a real database and a real model call —
// see this task's summary — and the pure decision logic is unit-tested
// directly in ask_grounding.test.ts.

const here = dirname(fileURLToPath(import.meta.url));

function readRouteSource(): string {
  return readFileSync(resolve(here, "..", "..", "..", "app", "api", "owner", "ask", "route.ts"), "utf-8");
}

test("route.ts — requireOwner() is checked before anything else, request body included", () => {
  const source = readRouteSource();
  const requireOwnerIdx = source.indexOf("await requireOwner()");
  const bodyParseIdx = source.indexOf("await request.json()");
  assert.ok(requireOwnerIdx > 0, "expected a requireOwner() call");
  assert.ok(bodyParseIdx > 0, "expected a request.json() call");
  assert.ok(requireOwnerIdx < bodyParseIdx, "requireOwner() must run before the request body is even parsed");
});

test("route.ts — owner_id is derived from the authenticated session, never from the request body", () => {
  const source = readRouteSource();
  assert.match(source, /const ownerId = check\.userId/);
  // No path anywhere in the file reads an owner_id out of the parsed body —
  // a client-supplied owner_id must be structurally impossible to reach.
  // (The explanatory comment above legitimately mentions "owner_id" in
  // prose, so this checks for actual access patterns, not the bare word.)
  assert.ok(!/body\.owner_id/.test(source), "must never read owner_id off the parsed request body");
  assert.ok(!/\{\s*owner_id\s*[,}]/.test(source), "must never destructure owner_id out of the request body");
  assert.match(
    source,
    /const \{ question \} = \(body \?\? \{\}\) as Record<string, unknown>/,
    "the body destructure must extract only question, nothing else"
  );
});

test("route.ts — answerQuestion is called with the session-derived ownerId, not any client input", () => {
  const source = readRouteSource();
  assert.match(source, /answerQuestion\(ownerId, question\.trim\(\)\)/);
});

test("route.ts — a refusal is returned as a plain 200 (no explicit error status), an answer as 200, only real failures use status 500", () => {
  const source = readRouteSource();
  const refusedIdx = source.indexOf('status: "refused"');
  assert.ok(refusedIdx > 0);
  // The NextResponse.json(...) call containing the refused payload must not
  // also pass a second { status: ... } argument — NextResponse.json defaults
  // to 200 when none is given, so a refusal is structurally indistinguishable
  // from any other success response, and structurally CANNOT collapse into
  // the error path.
  const returnStart = source.lastIndexOf("return NextResponse.json({", refusedIdx);
  const statementEnd = source.indexOf(";", refusedIdx);
  const statement = source.slice(returnStart, statementEnd);
  assert.ok(!/,\s*\{\s*status:/.test(statement), "a refusal must not carry an explicit (non-200) status code");

  const answeredIdx = source.indexOf('status: "answered"');
  const answeredReturnStart = source.lastIndexOf("return NextResponse.json({", answeredIdx);
  const answeredStatementEnd = source.indexOf(";", answeredIdx);
  const answeredStatement = source.slice(answeredReturnStart, answeredStatementEnd);
  assert.ok(!/,\s*\{\s*status:/.test(answeredStatement), "an answer must not carry an explicit (non-200) status code");
});

test("route.ts — the model-decision-failure and retrieval/model-call-failure paths both return status 500, distinct from refusal", () => {
  const source = readRouteSource();
  assert.match(source, /error: "Could not produce a grounded answer\."\s*\},\s*\{\s*status:\s*500\s*\}/);
  assert.match(source, /error: "Something went wrong answering that\."\s*\},\s*\{\s*status:\s*500\s*\}/);
});

test("route.ts — no console.* line references question content, only question.length", () => {
  const source = readRouteSource();
  const consoleLines = source.split("\n").filter((l) => /console\.(log|warn|error)\(/.test(l));
  assert.ok(consoleLines.length > 0, "expected at least one console.* call to check");
  for (const line of consoleLines) {
    if (line.includes("question")) {
      assert.match(line, /question\.length/, `console line referencing "question" must only use question.length: ${line}`);
    }
  }
});

test("route.ts — the catch-all error handler never logs err.message (search() embeds the raw query in its own error message)", () => {
  const source = readRouteSource();
  const catchIdx = source.indexOf("} catch (err) {", source.indexOf("[ask] retrieval or model failure") - 200);
  assert.ok(source.includes("[ask] retrieval or model failure"));
  const block = source.slice(source.indexOf("[ask] retrieval or model failure") - 20, source.indexOf("[ask] retrieval or model failure") + 100);
  assert.ok(!/err\.message/.test(block), "the retrieval/model failure log must not include err.message");
  assert.match(block, /err instanceof Error \? err\.name : typeof err/);
});

test("route.ts — no history/conversation parameter exists; single-turn is documented as a deliberate decision", () => {
  const source = readRouteSource();
  assert.match(source, /SINGLE-TURN ONLY/);
  assert.ok(
    !/history/i.test(source.replace(/SINGLE-TURN ONLY[\s\S]*?speculatively\./, "")),
    "no history scaffolding should exist outside the explanatory comment"
  );
});

test("route.ts — documents why this route is separate from the persona chat route", () => {
  const source = readRouteSource();
  assert.match(source, /SEPARATE route from[\s\S]{0,40}the persona chat/);
});

test("route.ts — no tool registry or agent loop is imported; this route never gives the model a tool-call surface", () => {
  const source = readRouteSource();
  assert.ok(!source.includes("TOOL_REGISTRY"));
  assert.ok(!source.includes("runAgentLoop"));
});
