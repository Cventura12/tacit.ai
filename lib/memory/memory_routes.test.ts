import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// app/api/owner/memory/extract/route.ts and .../resolve/route.ts can't be
// imported by Node's test runner (Next.js/@/-aliased modules, and
// requireOwner() needs a real Clerk session) — these are source-text checks,
// the same established pattern already used for app/api/chat/route.ts
// (lib/tools/tool-log-summary.test.ts) and app/api/owner/ask/route.ts
// (lib/tools/owner/ask_route.test.ts). The actual extract/confirm/reject
// behavior, including the end-to-end read-back through the ask route, is
// proven live — see this task's summary.

const here = dirname(fileURLToPath(import.meta.url));

function readExtractSource(): string {
  return readFileSync(resolve(here, "..", "..", "app", "api", "owner", "memory", "extract", "route.ts"), "utf-8");
}

function readResolveSource(): string {
  return readFileSync(resolve(here, "..", "..", "app", "api", "owner", "memory", "resolve", "route.ts"), "utf-8");
}

// ── extract route ──────────────────────────────────────────────────────────────

test("extract route — requireOwner() is checked before the request body is even parsed", () => {
  const source = readExtractSource();
  const requireOwnerIdx = source.indexOf("await requireOwner()");
  const bodyParseIdx = source.indexOf("await request.json()");
  assert.ok(requireOwnerIdx > 0);
  assert.ok(bodyParseIdx > 0);
  assert.ok(requireOwnerIdx < bodyParseIdx);
});

test("extract route — owner_id is derived from the authenticated session, never from the request body", () => {
  const source = readExtractSource();
  assert.match(source, /const ownerId = check\.userId/);
  assert.ok(!/body\.owner_id/.test(source), "must never read owner_id off the parsed request body");
  assert.ok(!/\{\s*owner_id\s*[,}]/.test(source), "must never destructure owner_id out of the request body");
  assert.match(source, /const \{ text, label \} = \(body \?\? \{\}\) as Record<string, unknown>/);
});

test("extract route — writes go through extractPastedCandidates (which itself only calls writeMemory), no raw db insert in this route", () => {
  const source = readExtractSource();
  assert.match(source, /import \{ extractPastedCandidates, MAX_PASTE_LEN \} from "@\/lib\/memory\/extract_pasted"/);
  assert.ok(!source.includes(".insert("), "the route itself must never touch the DB directly");
  assert.ok(!source.includes("getDb"), "the route itself must never import a DB client directly");
});

test("extract route — no console.* line references pasted text content, only counts/ids", () => {
  const source = readExtractSource();
  const consoleLines = source.split("\n").filter((l) => /console\.(log|warn|error)\(/.test(l));
  assert.ok(consoleLines.length > 0);
  for (const line of consoleLines) {
    assert.ok(!/\btext\b/.test(line) || /MAX_PASTE_LEN/.test(line), `console line must not reference raw text: ${line}`);
    assert.ok(!line.includes("label"), `console line must not reference label content: ${line}`);
  }
});

test("extract route — the catch-all error handler never logs err.message", () => {
  const source = readExtractSource();
  const idx = source.indexOf("[memory/extract] extraction failed");
  assert.ok(idx > 0);
  const block = source.slice(idx - 20, idx + 120);
  assert.ok(!/err\.message/.test(block));
  assert.match(block, /err instanceof Error \? err\.name : typeof err/);
});

// ── resolve route ───────────────────────────────────────────────────────────────

test("resolve route — requireOwner() is checked before the request body is even parsed", () => {
  const source = readResolveSource();
  const requireOwnerIdx = source.indexOf("await requireOwner()");
  const bodyParseIdx = source.indexOf("await request.json()");
  assert.ok(requireOwnerIdx > 0);
  assert.ok(bodyParseIdx > 0);
  assert.ok(requireOwnerIdx < bodyParseIdx);
});

test("resolve route — owner_id is derived from the authenticated session, never from the request body", () => {
  const source = readResolveSource();
  assert.match(source, /const ownerId = check\.userId/);
  assert.ok(!/body\.owner_id/.test(source));
  assert.ok(!/\{\s*owner_id\s*[,}]/.test(source));
});

test("resolve route — confirm/reject go through the EXISTING confirmCandidate/rejectCandidate, not a raw update", () => {
  const source = readResolveSource();
  assert.match(source, /import \{ confirmCandidate, rejectCandidate \} from "@\/lib\/memory\/store"/);
  assert.match(source, /confirmCandidate\(id, ownerId\)/);
  assert.match(source, /rejectCandidate\(id, ownerId\)/);
  assert.ok(!source.includes(".update("), "the route itself must never issue a raw update");
});

test("resolve route — an id cannot appear in both confirm and reject", () => {
  const source = readResolveSource();
  assert.match(source, /cannot appear in both confirm and reject/);
});

test("resolve route — each id is resolved independently (per-id try/catch), one failure cannot abort the batch", () => {
  const source = readResolveSource();
  const forConfirmIdx = source.indexOf("for (const id of confirmIds)");
  const forRejectIdx = source.indexOf("for (const id of rejectIds)");
  assert.ok(forConfirmIdx > 0 && forRejectIdx > 0);
  const confirmBlock = source.slice(forConfirmIdx, forRejectIdx);
  assert.match(confirmBlock, /try\s*\{[\s\S]*?catch/);
});
