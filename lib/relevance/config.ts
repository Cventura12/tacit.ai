// ── Relevance filter configuration ────────────────────────────────────────────
// Edit this file to tune what the coarse filter keeps or drops.
// Changes here take effect immediately — no logic files need touching.
//
// KEYWORD MATCHING: whole-word / \b boundary match, case-insensitive.
// "EAD" matches "EAD" and "EAD card" but NOT "read", "lead", or "ahead".
// Multi-word phrases ("deferred action") match as exact phrases at word boundaries.

export const RELEVANCE_CONFIG = {

  // ── Domain description ────────────────────────────────────────────────────
  // Plain-language description of what YOU consider relevant / worth routing
  // to the assistant. This is the ONE place a new user describes their own
  // domain — lib/relevance/smart.ts (stage 2, the AI classifier) reads this
  // field directly and stays domain-neutral in its own logic; it never
  // hardcodes a subject area. Change this to retarget stage 2 — no logic
  // file needs touching.
  //
  // Default below preserves the owner's current domain: immigration/
  // enrollment.
  domainDescription: `- Immigration status, USCIS filings, lawful presence, work authorization, EAD, SIJS, deferred action
- School enrollment, financial aid, residency verification, academic documents
- Any official notice or substantive question that requires a real reply`,

  // ── Allowlist ──────────────────────────────────────────────────────────────
  // Messages from these senders fast-pass stage 1 (no AI needed).
  allowlist: {
    // Bare domain or subdomain.  "uscis.gov" also matches "mail.uscis.gov".
    domains: [
      "uscis.gov",
      "dhs.gov",
      "eoir.usdoj.gov",
      "ice.dhs.gov",
      "state.gov",
      "chattanoogastate.edu",  // enrollment / financial aid
      "hac.edu",
    ],
    // Exact addresses (case-insensitive).
    addresses: [] as string[],
  },

  // ── Keywords ───────────────────────────────────────────────────────────────
  // Each keyword uses \b word boundaries — see coarse.ts.
  // KEEP THESE SPECIFIC: short bare acronyms that also appear as common English
  // words are flagged below. When in doubt, use a longer phrase instead.
  keywords: [
    // USCIS form numbers — hyphen means \bI-765\b still matches correctly
    "I-765", "I-360", "I-797", "I-94", "I-131",

    // Unambiguous USCIS / immigration labels
    "USCIS",
    "SIJS",                       // "special immigrant juvenile status" abbreviation
    "deferred action",
    "employment authorization",
    "EAD",                        // whole-word: matches "EAD card" NOT "read"/"ahead" ✓
    "special immigrant juvenile",
    "lawful presence",
    "work permit",
    "work authorization",
    "approval notice",
    "receipt notice",
    "immigration",

    // SAVE program — spelled out to avoid matching "save the date" / "save 40%"
    // (bare \bSAVE\b case-insensitive would match the common verb "save")
    "SAVE program",
    "SAVE system",
    "SAVE verification",

    // Enrollment / education
    "enrollment confirmation",
    "financial aid",
    "FAFSA",
    "verification of enrollment",
    "tuition",
    "residency verification",

    // Removed:
    //   "enrollment"     — kept above as "enrollment confirmation" to avoid matching
    //                      marketing "enroll now" / "enrollment open" for webinars
    //   "visa"           — \bvisa\b matches Visa (credit card) emails; covered by
    //                      "immigration" + form numbers
    //   "status update"  — generic tech/product newsletter phrase; stage 2 handles these
    //   "SAVE"           — bare word matches "save 40%" / "save the date"; use phrases above
  ],

  // ── Denylist ───────────────────────────────────────────────────────────────
  // Messages matching ANY denylist rule are dropped at stage 1.
  // Denylist patterns use plain substring matching (intentional — liberal drop).
  denylist: {
    // Substring matches against the full From header (case-insensitive).
    fromPatterns: [
      "noreply@",
      "no-reply@",
      "donotreply@",
      "do-not-reply@",
      "mailer-daemon@",
      "bounce@",
      "notifications@",
      "alerts@",
      "marketing@",
      "newsletter@",
      "promo@",
    ],
    // Substring matches against the subject line (case-insensitive).
    subjectPatterns: [
      "unsubscribe",
      "% off",
      "% discount",
      "sale ends",
      "limited time offer",
      "limited time only",
      "click here",
      "act now",
      "free shipping",
      "black friday",
      "cyber monday",
      "flash sale",
      "deal of the day",
      "daily deals",
    ],
    // Substring matches against the body/snippet (case-insensitive).
    bodyPatterns: [
      "unsubscribe from this list",
      "to stop receiving these emails",
      "to unsubscribe",
      "manage your email preferences",
      "you received this because you subscribed",
    ],
  },

} as const;

// Stage-2 AI triage: minimum score to keep a message.
// 0.0 = keep everything AI considers even slightly relevant; 1.0 = never keep.
// 0.4 is a reasonable starting point — raise if you get too many false positives.
export const SMART_THRESHOLD = 0.4;

// How many concurrent AI calls to make during stage 2.
export const SMART_CONCURRENCY = 4;
