import type { Message } from "./types";
import { RELEVANCE_CONFIG } from "./config";

type CoarseOutcome =
  | { decision: "drop"; reason: string }
  | { decision: "keep"; reason: string }   // fast-pass — AI stage skipped
  | { decision: "uncertain" };              // hand off to stage 2

// Pre-compile keyword regexes at module load — not per message.
// Uses \b word boundaries so "EAD" matches "EAD card" but not "read"/"ahead".
// Escapes regex metacharacters; hyphens in form numbers (I-765) are literal
// outside character classes so they need no special treatment.
function toWordBoundaryRegex(kw: string): RegExp {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

const KEYWORD_PATTERNS: ReadonlyArray<{ re: RegExp; kw: string }> =
  RELEVANCE_CONFIG.keywords.map((kw) => ({ re: toWordBoundaryRegex(kw), kw }));

export function coarseFilter(msg: Message): CoarseOutcome {
  const from    = msg.from.toLowerCase();
  const subject = msg.subject.toLowerCase();
  const body    = msg.body.toLowerCase();
  const text    = `${subject} ${body}`;

  const { denylist, allowlist } = RELEVANCE_CONFIG;

  // ── Drop: denylist (substring is intentional — liberal spam drop) ──────────
  for (const p of denylist.fromPatterns) {
    if (from.includes(p)) return { decision: "drop", reason: `denylist:from:${p}` };
  }
  for (const p of denylist.subjectPatterns) {
    if (subject.includes(p)) return { decision: "drop", reason: `denylist:subject:${p}` };
  }
  for (const p of denylist.bodyPatterns) {
    if (body.includes(p)) return { decision: "drop", reason: `denylist:body:${p}` };
  }

  // ── Keep: allowlisted sender domain ───────────────────────────────────────
  const fromDomain = from.match(/@([\w.-]+)/)?.[1] ?? "";
  for (const domain of allowlist.domains) {
    if (fromDomain === domain || fromDomain.endsWith(`.${domain}`)) {
      return { decision: "keep", reason: `allowlist:domain:${domain}` };
    }
  }
  for (const addr of allowlist.addresses) {
    if (from.includes(addr.toLowerCase())) {
      return { decision: "keep", reason: `allowlist:address:${addr}` };
    }
  }

  // ── Keep: whole-word keyword match ────────────────────────────────────────
  // \b boundaries prevent "EAD" matching "read"/"ahead", etc.
  for (const { re, kw } of KEYWORD_PATTERNS) {
    if (re.test(text)) {
      return { decision: "keep", reason: `keyword:${kw}` };
    }
  }

  // ── Uncertain: let stage 2 decide ─────────────────────────────────────────
  return { decision: "uncertain" };
}
