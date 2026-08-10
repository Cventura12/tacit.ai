// Deterministic, domain-neutral identifier-anchor extraction — replaces the
// old hardcoded FIXED_QUERIES immigration term list that used to run on
// every handle_email/cross_reference call regardless of topic.
//
// The property worth keeping from the old list: short, exact, OCR-stable
// tokens reliably match indexed text even when OCR quality is imperfect, and
// they run on every call without waiting on an LLM. The property that had to
// go: the tokens were a fixed, subject-specific vocabulary baked into the
// code, so an email about a lease or an invoice still searched for
// immigration terms. This extractor derives the same KIND of token — short
// identifier-shaped strings (form codes, case/claim/account/invoice/
// reference numbers) — directly from the ACTUAL source text, so the anchors
// always match what the email or question is actually about.
//
// Pattern: an optional short letter prefix, an optional separator, then a
// run of 2+ digits, then any trailing alphanumerics/hyphens — matches things
// like "INV-48213", "Case #A2024-119", "Ref 88213-B", "PO-9042" without
// assuming which of those domains applies.
const ANCHOR_PATTERN = /\b[A-Za-z]{0,4}[-#]?\d{2,}[A-Za-z0-9-]*\b/g;

// Caps chosen to keep the anchor set small and precise (mirrors the old
// FIXED_QUERIES list's size) rather than exhaustively matching every number
// in the text, which would reintroduce noise instead of signal.
const MAX_ANCHORS = 8;
const MAX_ANCHOR_LENGTH = 24;

export function extractIdentifierAnchors(text: string): string[] {
  const matches = text.match(ANCHOR_PATTERN) ?? [];
  const seen = new Set<string>();
  const anchors: string[] = [];

  for (const raw of matches) {
    const token = raw.trim();
    if (!token || token.length > MAX_ANCHOR_LENGTH) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push(token);
    if (anchors.length >= MAX_ANCHORS) break;
  }

  return anchors;
}
