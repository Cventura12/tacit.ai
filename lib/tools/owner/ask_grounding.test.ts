import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAskQueries,
  buildCitations,
  buildAnswerUserMessage,
  classifyAskOutcome,
} from "./ask_grounding.ts";

// ── buildAskQueries ────────────────────────────────────────────────────────────

test("buildAskQueries — the raw question is always included", () => {
  const queries = buildAskQueries("what's my lease end date?", []);
  assert.ok(queries.includes("what's my lease end date?"));
});

test("buildAskQueries — the raw question survives even when expansion returns nothing (LLM failure/empty)", () => {
  const queries = buildAskQueries("some question", []);
  assert.deepEqual(queries, ["some question"]);
});

test("buildAskQueries — generated queries are included alongside the raw question", () => {
  const queries = buildAskQueries("q", ["expanded one", "expanded two"]);
  assert.deepEqual(queries, ["q", "expanded one", "expanded two"]);
});

test("buildAskQueries — deduplicates when the LLM regenerates the question verbatim", () => {
  const queries = buildAskQueries("same text", ["same text", "different"]);
  assert.deepEqual(queries, ["same text", "different"]);
});

// ── buildCitations ─────────────────────────────────────────────────────────────

test("buildCitations — shapes document hits as kind:'document' citations", () => {
  const citations = buildCitations(
    [{ doc_id: "d1", title: "Lease Agreement", doc_type: null, page: 3, snippet: "...", highlight: "" }],
    []
  );
  assert.deepEqual(citations, [{ kind: "document", doc_id: "d1", title: "Lease Agreement", page: 3 }]);
});

test("buildCitations — shapes memory hits as kind:'memory' citations", () => {
  const citations = buildCitations(
    [],
    [
      {
        id: "m1",
        claim: "lease ends 2026-05-01",
        memory_type: "observed",
        source_kind: "document",
        source_id: "doc-1",
        source_locator: null,
        confidence: null,
        score: 0.9,
      },
    ]
  );
  assert.deepEqual(citations, [
    { kind: "memory", claim: "lease ends 2026-05-01", source_kind: "document", source_id: "doc-1" },
  ]);
});

test("buildCitations — zero docs and zero memories yields an empty array", () => {
  assert.deepEqual(buildCitations([], []), []);
});

test("buildCitations — combines both corpora into one array", () => {
  const citations = buildCitations(
    [{ doc_id: "d1", title: "Doc", doc_type: null, page: 1, snippet: "", highlight: "" }],
    [
      {
        id: "m1",
        claim: "claim text",
        memory_type: "owner_stated",
        source_kind: "email",
        source_id: "msg-1",
        source_locator: null,
        confidence: null,
        score: 0.5,
      },
    ]
  );
  assert.equal(citations.length, 2);
  assert.equal(citations[0].kind, "document");
  assert.equal(citations[1].kind, "memory");
});

// ── buildAnswerUserMessage ─────────────────────────────────────────────────────

test("buildAnswerUserMessage — includes the question and the grounding block verbatim", () => {
  const prompt = buildAnswerUserMessage("what's my lease end date?", "SOME GROUNDING BLOCK");
  assert.ok(prompt.includes("what's my lease end date?"));
  assert.ok(prompt.includes("SOME GROUNDING BLOCK"));
});

test("buildAnswerUserMessage — instructs refusal over guessing when unsupported", () => {
  const prompt = buildAnswerUserMessage("q", "block");
  assert.match(prompt, /do NOT guess, hedge with a probable answer, or partially answer/);
  assert.match(prompt, /"grounded":\s*true\|false/);
});

test("buildAnswerUserMessage — never references drafting a reply email (this is a sibling of buildDraftUserMessage, not a reuse)", () => {
  const prompt = buildAnswerUserMessage("q", "block");
  assert.ok(!/draft a reply email/i.test(prompt));
});

// ── classifyAskOutcome ──────────────────────────────────────────────────────────

test("classifyAskOutcome — grounded:true with an answer is classified 'answered'", () => {
  const outcome = classifyAskOutcome(JSON.stringify({ grounded: true, answer: "the lease ends May 1, 2026." }));
  assert.deepEqual(outcome, { kind: "answered", answer: "the lease ends May 1, 2026." });
});

test("classifyAskOutcome — grounded:false is classified 'refused', a success shape, with the given reason", () => {
  const outcome = classifyAskOutcome(
    JSON.stringify({ grounded: false, refusal_reason: "no document mentions this." })
  );
  assert.deepEqual(outcome, { kind: "refused", reason: "no document mentions this." });
});

test("classifyAskOutcome — grounded:false with no refusal_reason still refuses, using a default reason", () => {
  const outcome = classifyAskOutcome(JSON.stringify({ grounded: false }));
  assert.equal(outcome.kind, "refused");
  assert.ok((outcome as { reason: string }).reason.length > 0);
});

test("classifyAskOutcome — grounded:true with a missing/empty answer is an error, not a false answer", () => {
  assert.equal(classifyAskOutcome(JSON.stringify({ grounded: true })).kind, "error");
  assert.equal(classifyAskOutcome(JSON.stringify({ grounded: true, answer: "" })).kind, "error");
  assert.equal(classifyAskOutcome(JSON.stringify({ grounded: true, answer: "   " })).kind, "error");
});

test("classifyAskOutcome — unparseable model output is an error, never silently a refusal or an answer", () => {
  const outcome = classifyAskOutcome("not valid json {{{");
  assert.equal(outcome.kind, "error");
});

test("classifyAskOutcome — a 'grounded' field that is neither true nor false is an error", () => {
  assert.equal(classifyAskOutcome(JSON.stringify({ grounded: "yes", answer: "x" })).kind, "error");
  assert.equal(classifyAskOutcome(JSON.stringify({ answer: "x" })).kind, "error");
});

test("classifyAskOutcome — strips markdown code fences before parsing", () => {
  const raw = "```json\n" + JSON.stringify({ grounded: true, answer: "fenced answer" }) + "\n```";
  const outcome = classifyAskOutcome(raw);
  assert.deepEqual(outcome, { kind: "answered", answer: "fenced answer" });
});

test("classifyAskOutcome — refusal and error are never the same shape (the property the whole feature depends on)", () => {
  const refused = classifyAskOutcome(JSON.stringify({ grounded: false, refusal_reason: "not covered" }));
  const errored = classifyAskOutcome("garbage");
  assert.notEqual(refused.kind, errored.kind);
  assert.equal(refused.kind, "refused");
  assert.equal(errored.kind, "error");
});
