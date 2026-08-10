import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Static source checks rather than importing read_gmail.ts directly — it pulls
// in lib/gmail.ts's real (non-type-only) exports, which is fine for the actual
// app (Next.js resolves the @/ alias) but not for Node's native test runner.
// A text-level check is also the more precise way to prove "this tool never
// calls the full-body retrieval path" — the concrete, exact claim under test.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "read_gmail.ts"), "utf-8");

test("read_gmail — never calls readMessageBody (stays a listing/snippet tool only)", () => {
  assert.ok(!source.includes("readMessageBody"), "read_gmail must not retrieve full message bodies");
});

test("read_gmail — imports only readRecent from the Gmail layer", () => {
  assert.match(source, /import\s*\{\s*readRecent\s*\}\s*from/);
});

test("read_gmail — description tells the model the snippet is a preview, not the full message", () => {
  assert.match(source, /preview/i);
  assert.match(source, /read_gmail_message/);
});
