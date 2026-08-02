// Gmail integration — server-side only.
// Uses plain fetch to the Gmail REST API. No googleapis SDK, no new packages.
// SCOPES: gmail.readonly (read inbox) + gmail.send (send on behalf of owner).

import { randomBytes, createHash } from "crypto";
import { encryptCredential, decryptCredential, maskCredential } from "./crypto.ts";
import { getDb, isDbConfigured } from "./db.ts";

export const GMAIL_CONNECTOR_ID = "00000000-0000-0000-0000-000000000003";
// Both scopes space-separated — OAuth consent must include send to allow sending.
export const GMAIL_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly " +
  "https://www.googleapis.com/auth/gmail.send";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// ─── Diagnostic helpers ───────────────────────────────────────────────────────

async function loggedFetch(label: string, url: string, init?: RequestInit): Promise<Response> {
  console.log(`[gmail] → ${init?.method ?? "GET"} ${label}`);
  const res = await fetch(url, init);
  console.log(`[gmail] ← ${res.status} ${res.statusText} (${label})`);
  if (!res.ok) {
    let body = "(could not read body)";
    try { body = await res.clone().text(); } catch { /* ignore */ }
    console.error(`[gmail] error body (${label}):`, body);
  }
  return res;
}

// Pulls only Google's own low-cardinality error classification (numeric/string
// `code`, string `status`, e.g. "NOT_FOUND") out of a parsed Gmail API error
// body — never the free-text `message` field, and never anything else in the
// object. Used by loggedFetchNoBodyLog below; exported so this extraction
// discipline is directly unit-testable against a realistic error payload.
export function extractSafeProviderErrorFields(
  rawJson: unknown
): { code?: string | number; status?: string } {
  if (!rawJson || typeof rawJson !== "object") return {};
  const body = rawJson as { error?: { code?: unknown; status?: unknown } };
  const code = body.error?.code;
  const status = body.error?.status;
  return {
    code: typeof code === "string" || typeof code === "number" ? code : undefined,
    status: typeof status === "string" ? status : undefined,
  };
}

// Pure so the "what actually gets logged" text is directly testable — its
// signature has no parameter that could ever carry a body/snippet/message
// string, which is a structural (not just behavioral) guarantee.
export function buildFetchFailureLogLine(
  label: string,
  httpStatus: number,
  providerCode?: string | number,
  providerStatus?: string
): string {
  return (
    `[gmail] ${label} failed: http_status=${httpStatus}` +
    (providerCode !== undefined ? ` provider_code=${providerCode}` : "") +
    (providerStatus ? ` provider_status=${providerStatus}` : "")
  );
}

// Like loggedFetch, but for the Gmail message-body and attachment-body
// retrieval calls specifically: on a non-ok response it never logs the raw
// response text. It attempts to parse Google's own structured error
// code/status (safe, low-cardinality classification) and logs only those —
// the free-text `message` field, and the raw body in general, are discarded
// unread by this path. loggedFetch itself is intentionally left unchanged —
// it's shared by token exchange/refresh/send/list, which are out of scope
// here — this is a narrow, path-specific hardening, not a general rewrite.
async function loggedFetchNoBodyLog(label: string, url: string, init?: RequestInit): Promise<Response> {
  console.log(`[gmail] → ${init?.method ?? "GET"} ${label}`);
  const res = await fetch(url, init);
  console.log(`[gmail] ← ${res.status} ${res.statusText} (${label})`);
  if (!res.ok) {
    let safe: { code?: string | number; status?: string } = {};
    try {
      safe = extractSafeProviderErrorFields(await res.clone().json());
    } catch {
      // Not JSON, or unreadable — fine; nothing is extracted, nothing raw is logged.
    }
    console.error(buildFetchFailureLogLine(label, res.status, safe.code, safe.status));
  }
  return res;
}

function googleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not configured");
  return id;
}

function googleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not configured");
  return secret;
}

function googleRedirectUri(): string {
  const uri = process.env.GOOGLE_REDIRECT_URI;
  if (!uri) throw new Error("GOOGLE_REDIRECT_URI is not configured");
  return uri;
}

// ─── OAuth consent URL ────────────────────────────────────────────────────────
// Send the owner here to initiate the OAuth flow.
// access_type=offline + prompt=consent guarantees a refresh_token on every grant.

export function buildConsentUrl(state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", googleClientId());
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

// ─── Save refresh token from auth code ───────────────────────────────────────
// Called from the OAuth callback route after Google redirects back with ?code=...
// Exchanges the code for tokens, encrypts the refresh_token, upserts the
// connector row so it appears in the OwnerPanel like any other builtin connector.

export async function saveRefreshTokenFromCode(code: string): Promise<void> {
  const res = await loggedFetch("token exchange", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);

  const body = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
  };

  if (!body.refresh_token) {
    throw new Error(
      body.error
        ? `Google returned an error: ${body.error}`
        : "No refresh_token in response — ensure access_type=offline and prompt=consent were set on the consent URL."
    );
  }

  const encrypted = encryptCredential(body.refresh_token);
  const masked = maskCredential(body.refresh_token);

  if (!isDbConfigured()) throw new Error("Database is not configured");
  const db = getDb();

  const { error } = await db.from("connectors").upsert(
    {
      id: GMAIL_CONNECTOR_ID,
      type: "builtin",
      name: "Gmail (read + send)",
      description: "Read your Gmail inbox and send owner-approved draft replies.",
      tool_names: ["read_gmail"],
      enabled: true,
      lane: "owner",
      mcp_url: null,
      credential_encrypted: encrypted,
      credential_masked: masked,
    },
    { onConflict: "id" }
  );

  if (error) throw new Error(`Failed to save Gmail connector: ${error.message}`);
  console.log("[gmail] connector row upserted");
}

// ─── Access token (private) ───────────────────────────────────────────────────
// Reads the stored refresh token, decrypts it, and exchanges it for a
// short-lived access token. Called internally before every API request.

async function getAccessToken(): Promise<string> {
  if (!isDbConfigured()) throw new Error("Database is not configured");
  const db = getDb();

  const { data, error } = await db
    .from("connectors")
    .select("credential_encrypted, enabled")
    .eq("id", GMAIL_CONNECTOR_ID)
    .single();

  if (error || !data) throw new Error("Gmail connector not found — connect Gmail first");
  if (!data.enabled) throw new Error("Gmail connector is disabled");
  if (!data.credential_encrypted) throw new Error("Gmail connector has no stored credentials");

  const refreshToken = decryptCredential(data.credential_encrypted);

  const res = await loggedFetch("token refresh", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
    }).toString(),
  });

  // Parse body regardless of status — Google's 400 contains actionable error details.
  // loggedFetch already read a clone for logging, so the original body is still readable.
  const body = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok) {
    if (body.error === "invalid_grant") {
      // Refresh token has expired or been revoked. Most common cause: the Google Cloud
      // OAuth consent screen is in "Testing" publishing status, which forces all refresh
      // tokens to expire after 7 days. Fix: Google Cloud Console → APIs & Services →
      // OAuth consent screen → Publishing status → "Publish app" → In production.
      // After fixing, the user must reconnect Gmail once to get a new refresh token.
      //
      // Clear the stale credential now so the Connections page shows "disconnected"
      // rather than silently failing on every subsequent call.
      console.error("[gmail] invalid_grant — clearing stale credential");
      await db
        .from("connectors")
        .update({ credential_encrypted: null, credential_masked: null })
        .eq("id", GMAIL_CONNECTOR_ID)
        .then(({ error: dbErr }) => {
          if (dbErr) console.warn("[gmail] failed to clear stale credential:", dbErr.message);
        });
      throw new Error(
        "Gmail refresh token expired (invalid_grant). " +
          "Most likely cause: Google Cloud OAuth app is in 'Testing' status — refresh tokens expire after 7 days. " +
          "Fix: Google Cloud Console → OAuth consent screen → set Publishing status to 'In production', then reconnect Gmail."
      );
    }
    throw new Error(
      `Token refresh failed (${res.status}): ${body.error ?? "unknown"}` +
        (body.error_description ? ` — ${body.error_description}` : "")
    );
  }

  if (!body.access_token) {
    throw new Error(
      body.error
        ? `Google token refresh error: ${body.error}`
        : "No access_token in refresh response"
    );
  }

  return body.access_token;
}

// ─── Send email ──────────────────────────────────────────────────────────────

export interface SendGmailParams {
  to: string;
  subject: string;
  body: string;
  thread_id?: string;
  in_reply_to_id?: string;
  attachments?: Array<{ filename: string; content: Buffer; mimeType: string }>;
}

export interface SendGmailResult {
  message_id: string;
  thread_id: string;
}

export async function sendGmail(params: SendGmailParams): Promise<SendGmailResult> {
  const token = await getAccessToken();
  const raw = buildMimeRaw(params);

  const payload: Record<string, string> = { raw };
  if (params.thread_id) payload.threadId = params.thread_id;

  const res = await loggedFetch("messages.send", `${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Gmail send failed (${res.status})`);

  const result = (await res.json()) as { id: string; threadId: string };
  return { message_id: result.id, thread_id: result.threadId };
}

// RFC 2045 §6.8 — standard base64 in 76-char lines (for MIME body parts).
function base64Lines(buf: Buffer): string {
  const b64 = buf.toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += 76) chunks.push(b64.slice(i, i + 76));
  return chunks.join("\r\n");
}

// RFC 2047 Q-encoding for non-ASCII subject lines.
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

function buildMimeRaw(params: SendGmailParams): string {
  const { to, subject, body, in_reply_to_id, attachments = [] } = params;
  const CRLF = "\r\n";
  const boundary = `tacit_${randomBytes(10).toString("hex")}`;

  const hdr: string[] = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
  ];

  if (in_reply_to_id) {
    const mid = in_reply_to_id.startsWith("<") ? in_reply_to_id : `<${in_reply_to_id}>`;
    hdr.push(`In-Reply-To: ${mid}`);
    hdr.push(`References: ${mid}`);
  }

  let mime: string;

  if (attachments.length === 0) {
    hdr.push("Content-Type: text/plain; charset=UTF-8");
    hdr.push("Content-Transfer-Encoding: base64");
    mime = hdr.join(CRLF) + CRLF + CRLF + base64Lines(Buffer.from(body, "utf-8"));
  } else {
    hdr.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const parts: string[] = [
      `--${boundary}${CRLF}` +
        `Content-Type: text/plain; charset=UTF-8${CRLF}` +
        `Content-Transfer-Encoding: base64${CRLF}` +
        CRLF +
        base64Lines(Buffer.from(body, "utf-8")),
    ];

    for (const att of attachments) {
      const safe = att.filename.replace(/[^\w.\- ]/g, "_");
      parts.push(
        `--${boundary}${CRLF}` +
          `Content-Type: ${att.mimeType}; name="${safe}"${CRLF}` +
          `Content-Transfer-Encoding: base64${CRLF}` +
          `Content-Disposition: attachment; filename="${safe}"${CRLF}` +
          CRLF +
          base64Lines(att.content)
      );
    }

    mime =
      hdr.join(CRLF) + CRLF + CRLF +
      parts.join(CRLF) + CRLF +
      `--${boundary}--`;
  }

  return Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ─── Read recent messages ─────────────────────────────────────────────────────

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

// Returns metadata only — never fetches message body.
// Skips individual messages that fail so one bad message can't break the batch.
export async function readRecent(
  query = "in:inbox",
  max = 10
): Promise<GmailMessage[]> {
  const clampedMax = Math.max(1, Math.min(max, 25));
  const token = await getAccessToken();

  const authHeader = { Authorization: `Bearer ${token}` };

  // 1. List message IDs matching the query
  const listUrl = new URL(`${GMAIL_API}/users/me/messages`);
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(clampedMax));

  const listRes = await loggedFetch("messages.list", listUrl.toString(), {
    headers: authHeader,
  });
  if (!listRes.ok) throw new Error(`Failed to list messages (${listRes.status})`);

  const listBody = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };

  const ids = listBody.messages ?? [];
  console.log(`[gmail] message IDs returned: ${ids.length}`);

  // 2. Fetch metadata for each message (From, Subject, Date headers + snippet)
  const results: GmailMessage[] = [];

  await Promise.all(
    ids.map(async ({ id }) => {
      try {
        const msgUrl = new URL(`${GMAIL_API}/users/me/messages/${id}`);
        msgUrl.searchParams.set("format", "metadata");
        msgUrl.searchParams.append("metadataHeaders", "From");
        msgUrl.searchParams.append("metadataHeaders", "Subject");
        msgUrl.searchParams.append("metadataHeaders", "Date");

        const msgRes = await loggedFetch(`messages.get(${id})`, msgUrl.toString(), {
          headers: authHeader,
        });
        if (!msgRes.ok) {
          console.warn(`[gmail] skipping message ${id}: ${msgRes.status}`);
          return;
        }

        const msg = (await msgRes.json()) as {
          id: string;
          snippet?: string;
          labelIds?: string[];
          payload?: {
            headers?: Array<{ name: string; value: string }>;
          };
        };

        const headers = msg.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

        results.push({
          id: msg.id,
          from: get("From"),
          subject: get("Subject"),
          snippet: msg.snippet ?? "",
          date: get("Date"),
          unread: (msg.labelIds ?? []).includes("UNREAD"),
        });
      } catch (err) {
        console.warn(`[gmail] skipping message ${id}:`, err);
      }
    })
  );

  // Restore listing order (Promise.all resolves in arbitrary order)
  const order = new Map(ids.map(({ id }, i) => [id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return results;
}

// ─── Read full message body — retrieval + recursive MIME parsing ──────────────
//
// readMessageBody() fetches format=full and hands the payload to
// parseGmailMessage(), which is the pure, directly-testable parsing core (no
// network/DB access — see lib/gmail.test.ts). This split exists specifically so
// the MIME-traversal/completeness logic can be tested against literal payload
// fixtures without mocking fetch or the database.

export interface GmailPayload {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPayload[];
}

export type ContentCompleteness = "full" | "partial" | "snippet_only" | "fetch_failed";

export interface AttachmentMetadata {
  filename: string;
  mimeType: string;
  size: number | null;
  attachmentId: string | null;
}

export interface MessageBodyResult {
  text: string;
  content_completeness: ContentCompleteness;
  locally_truncated: boolean;
  parts_failed: number;
  original_character_count: number | null;
  attachments: AttachmentMetadata[];
  error_codes: string[];
}

// Configurable so an unusually long real email doesn't force a code change —
// deliberately generous so truncation stays exceptional (see truncateBody).
const MAX_BODY_CHARS = Number(process.env.GMAIL_BODY_MAX_CHARS) || 20000;
const TRUNCATION_MARKER = "\n\n[… message truncated — middle section omitted …]\n\n";

// ── Base64url decoding, malformed-input safe ─────────────────────────────────
// Buffer.from(str, "base64") is lenient by default (silently drops invalid
// characters instead of throwing), which would let corrupted data through as
// mangled text. We validate the character set explicitly so genuinely malformed
// data throws and can be caught per-part, rather than silently producing garbage.

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
    throw new Error("malformed base64 data");
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

// ── HTML → plain text ────────────────────────────────────────────────────────
// Deliberately staged (strip non-content blocks → convert structural tags to
// line breaks → strip remaining tags → decode entities → collapse whitespace)
// rather than a single regex, so paragraph/list/line-break structure survives.
// Never executes or renders HTML — pure string transformation.

const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = HTML_NAMED_ENTITIES[entity.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

export function htmlToText(html: string): string {
  let out = html;

  // Remove non-visible content entirely, including its contents.
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Turn structural tags into line breaks BEFORE stripping tags, so paragraph/
  // list/line structure survives as plain-text spacing.
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/(p|div|tr|table|h[1-6]|blockquote)\s*>/gi, "\n\n");
  out = out.replace(/<li[^>]*>/gi, "\n- ");
  out = out.replace(/<\/li>/gi, "");

  // Strip every remaining tag.
  out = out.replace(/<[^>]+>/g, "");

  out = decodeHtmlEntities(out);

  // Collapse whitespace, keeping intentional paragraph breaks.
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n[ \t]+/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// ── Local truncation — preserves head and tail, marks the cut visibly ──────────
// Institutional emails often put context/instructions near the start and
// deadlines/links/signatures near the end, so the middle (not an edge) is what
// gets removed.

function truncateBody(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const headChars = Math.floor(maxChars / 2);
  const tailChars = maxChars - headChars;
  const head = text.slice(0, headChars);
  const tail = text.slice(text.length - tailChars);
  return { text: head + TRUNCATION_MARKER + tail, truncated: true };
}

// ── MIME traversal ────────────────────────────────────────────────────────────

interface BodyCandidate {
  text: string;
  mimeType: "text/plain" | "text/html";
}

interface TraversalResult {
  candidate: BodyCandidate | null;
  attachments: AttachmentMetadata[];
  partsFailed: number;
  errorCodes: Set<string>;
  decodedBytes: number;
  partCount: number;
}

export interface ParseOptions {
  // Called for a text/plain or text/html part whose content is stored behind
  // body.attachmentId rather than inline body.data. Defaults to a no-op that
  // always fails (used implicitly when no fetcher is supplied, e.g. in tests
  // that don't exercise that path) — readMessageBody() supplies a real one.
  fetchAttachmentData?: (attachmentId: string) => Promise<string>;
  // The Gmail search-result snippet for this message, used as the fallback
  // text when no usable full/partial body can be extracted.
  snippetFallback?: string;
}

function emptyTraversal(): TraversalResult {
  return { candidate: null, attachments: [], partsFailed: 0, errorCodes: new Set(), decodedBytes: 0, partCount: 0 };
}

function mergeInto(target: TraversalResult, source: TraversalResult): void {
  target.attachments.push(...source.attachments);
  target.partsFailed += source.partsFailed;
  target.decodedBytes += source.decodedBytes;
  target.partCount += source.partCount;
  for (const code of source.errorCodes) target.errorCodes.add(code);
}

function hasAttachmentDisposition(part: GmailPayload): boolean {
  const headers = part.headers ?? [];
  const cd = headers.find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
  return /attachment/i.test(cd);
}

// Gmail's own signal for "this part is a file, not the message body": genuine
// body parts have an empty filename; attachments (of any type, including a
// plain-text or HTML *file* someone attached) have a non-empty one, or an
// explicit Content-Disposition: attachment header.
function isFileAttachment(part: GmailPayload): boolean {
  const mimeType = part.mimeType ?? "";
  const hasFilename = !!(part.filename && part.filename.trim().length > 0);
  if (mimeType === "text/plain" || mimeType === "text/html") {
    return hasFilename || hasAttachmentDisposition(part);
  }
  // Any other concrete (non-multipart) type is a file part — images, PDFs, etc.
  return !mimeType.startsWith("multipart/");
}

function buildAttachmentMetadata(part: GmailPayload): AttachmentMetadata {
  return {
    filename: part.filename && part.filename.trim() ? part.filename : "(unnamed)",
    mimeType: part.mimeType || "application/octet-stream",
    size: typeof part.body?.size === "number" ? part.body.size : null,
    attachmentId: part.body?.attachmentId ?? null,
  };
}

// A leaf text/plain or text/html part. Resolves to a usable candidate, or to
// "nothing here" (no failure) when the part is genuinely empty, or to a
// failure when the part has content it should be able to decode/fetch but
// can't. See the module-level comment on partial-vs-full semantics.
async function resolveBodyLeaf(
  part: GmailPayload,
  mimeType: "text/plain" | "text/html",
  opts: ParseOptions
): Promise<TraversalResult> {
  const body = part.body ?? {};

  let rawBase64: string | null = null;
  if (body.data) {
    rawBase64 = body.data;
  } else if (body.attachmentId) {
    try {
      if (!opts.fetchAttachmentData) throw new Error("no attachment fetcher configured");
      rawBase64 = await opts.fetchAttachmentData(body.attachmentId);
    } catch {
      const result = emptyTraversal();
      result.partsFailed = 1;
      result.errorCodes.add("GMAIL_BODY_PART_FETCH_FAILED");
      return result;
    }
  } else {
    // No data pointer at all — legitimately empty, not a failure.
    return emptyTraversal();
  }

  if (rawBase64 === null) {
    // Unreachable given the branches above, but keeps the decode call below
    // typed against `string` without relying on control-flow narrowing through
    // the try/catch above.
    return emptyTraversal();
  }

  let decoded: string;
  try {
    decoded = decodeBase64Url(rawBase64);
  } catch {
    const result = emptyTraversal();
    result.partsFailed = 1;
    result.errorCodes.add("GMAIL_BASE64_DECODE_FAILED");
    return result;
  }

  const decodedBytes = Buffer.byteLength(decoded, "utf-8");
  const text = mimeType === "text/html" ? htmlToText(decoded) : decoded;

  if (!text.trim()) {
    // Decoded successfully but the content is genuinely empty/whitespace —
    // not a failure, just nothing usable from this part.
    const result = emptyTraversal();
    result.decodedBytes = decodedBytes;
    return result;
  }

  const result = emptyTraversal();
  result.candidate = { text, mimeType };
  result.decodedBytes = decodedBytes;
  return result;
}

// multipart/alternative: try text/plain first, fall back to text/html only if
// plain is empty/missing/whitespace-only. Never concatenates both. A part that
// fails to decode/fetch still counts toward partsFailed even if a sibling
// alternative recovers — it was relevant and it didn't work — but an
// alternative that's simply absent or empty never does.
async function resolveAlternative(children: GmailPayload[], opts: ParseOptions): Promise<TraversalResult> {
  const merged = emptyTraversal();
  let plainCandidate: BodyCandidate | null = null;
  let htmlCandidate: BodyCandidate | null = null;

  for (const child of children) {
    const res = await traverse(child, opts);
    mergeInto(merged, res);
    if (res.candidate?.mimeType === "text/plain" && !plainCandidate) plainCandidate = res.candidate;
    else if (res.candidate?.mimeType === "text/html" && !htmlCandidate) htmlCandidate = res.candidate;
  }

  merged.candidate = plainCandidate ?? htmlCandidate ?? null;
  return merged;
}

// Any traversable node that isn't multipart/alternative (multipart/mixed,
// multipart/related, multipart/report, nested combinations, ...): traverse
// every child, take the first usable body candidate found (in document order),
// and collect every attachment regardless of which child "wins."
async function resolveContainer(children: GmailPayload[], opts: ParseOptions): Promise<TraversalResult> {
  const merged = emptyTraversal();
  for (const child of children) {
    const res = await traverse(child, opts);
    mergeInto(merged, res);
    if (!merged.candidate && res.candidate) merged.candidate = res.candidate;
  }
  return merged;
}

async function traverse(part: GmailPayload, opts: ParseOptions): Promise<TraversalResult> {
  const mimeType = part.mimeType ?? "";

  if (mimeType.startsWith("multipart/")) {
    const children = part.parts ?? [];
    const result =
      mimeType === "multipart/alternative"
        ? await resolveAlternative(children, opts)
        : await resolveContainer(children, opts);
    result.partCount += 1;
    return result;
  }

  if (isFileAttachment(part)) {
    const result = emptyTraversal();
    result.attachments.push(buildAttachmentMetadata(part));
    result.partCount = 1;
    return result;
  }

  if (mimeType === "text/plain" || mimeType === "text/html") {
    const result = await resolveBodyLeaf(part, mimeType, opts);
    result.partCount += 1;
    return result;
  }

  // An unrecognized leaf type with no filename — nothing relevant here, and
  // not a failure (we simply don't have a use for it).
  const result = emptyTraversal();
  result.partCount = 1;
  return result;
}

// ── Result construction ───────────────────────────────────────────────────────
// Consistent, documented fallback rule used everywhere a usable full/partial
// body could not be produced (top-level fetch failure, malformed JSON, empty
// payload, or a traversal that found nothing usable): if a non-empty snippet
// was supplied, the result is "snippet_only" (there IS something usable, just
// not from the full-body path). Only when no snippet is available either does
// the result become "fetch_failed" — reserved for "nothing usable exists at
// all," not merely "the full-body path came up empty."
export function buildUnavailableBodyResult(
  opts: ParseOptions,
  baseErrorCodes: string[],
  attachments: AttachmentMetadata[] = [],
  partsFailed = 0
): MessageBodyResult {
  const snippet = (opts.snippetFallback ?? "").trim();
  const errorCodes = new Set(baseErrorCodes);
  if (snippet) {
    errorCodes.add("GMAIL_BODY_SNIPPET_FALLBACK");
    return {
      text: snippet,
      content_completeness: "snippet_only",
      locally_truncated: false,
      parts_failed: partsFailed,
      original_character_count: null,
      attachments,
      error_codes: [...errorCodes],
    };
  }
  return {
    text: "",
    content_completeness: "fetch_failed",
    locally_truncated: false,
    parts_failed: partsFailed,
    original_character_count: null,
    attachments,
    error_codes: [...errorCodes],
  };
}

// Richer internal shape — adds partCount/decodedBytes, which are useful for
// safe logging but are deliberately NOT part of the public MessageBodyResult
// contract. parseGmailMessage() (the tested, spec-matching pure function)
// strips down to the public shape; readMessageBody() uses the richer variant
// directly so its log line can include them.
interface InternalParseResult {
  result: MessageBodyResult;
  partCount: number;
  decodedBytes: number;
}

async function parseGmailMessageInternal(
  payload: GmailPayload | undefined,
  opts: ParseOptions
): Promise<InternalParseResult> {
  if (!payload) {
    return { result: buildUnavailableBodyResult(opts, ["GMAIL_BODY_EMPTY"]), partCount: 0, decodedBytes: 0 };
  }

  let traversal: TraversalResult;
  try {
    traversal = await traverse(payload, opts);
  } catch {
    // MIME traversal failed unexpectedly (malformed/unexpected payload shape)
    // — degrade gracefully rather than throwing out of the whole pipeline.
    return { result: buildUnavailableBodyResult(opts, ["GMAIL_MIME_PARSE_FAILED"]), partCount: 0, decodedBytes: 0 };
  }

  if (!traversal.candidate) {
    // Preserve the SPECIFIC codes accumulated during traversal (e.g. a real
    // decode or fetch failure on the only relevant part) rather than
    // discarding them in favor of a generic one.
    const codes = ["GMAIL_BODY_EMPTY", ...traversal.errorCodes];
    return {
      result: buildUnavailableBodyResult(opts, codes, traversal.attachments, traversal.partsFailed),
      partCount: traversal.partCount,
      decodedBytes: traversal.decodedBytes,
    };
  }

  const originalCharacterCount = traversal.candidate.text.length;
  const { text, truncated } = truncateBody(traversal.candidate.text, MAX_BODY_CHARS);
  const errorCodes = new Set(traversal.errorCodes);
  if (truncated) errorCodes.add("GMAIL_BODY_LOCALLY_TRUNCATED");

  return {
    result: {
      text,
      // Local truncation never changes full → partial — only a relevant part
      // actually failing does.
      content_completeness: traversal.partsFailed > 0 ? "partial" : "full",
      locally_truncated: truncated,
      parts_failed: traversal.partsFailed,
      original_character_count: originalCharacterCount,
      attachments: traversal.attachments,
      error_codes: [...errorCodes],
    },
    partCount: traversal.partCount,
    decodedBytes: traversal.decodedBytes,
  };
}

// The pure parsing core: given an already-fetched Gmail payload, produces the
// full MessageBodyResult. No network or DB access — safe to unit test directly
// against literal payload fixtures (see lib/gmail.test.ts). Only
// opts.fetchAttachmentData (when provided) performs I/O, and it's caller-
// injected specifically so tests can supply a fake.
export async function parseGmailMessage(
  payload: GmailPayload | undefined,
  opts: ParseOptions
): Promise<MessageBodyResult> {
  return (await parseGmailMessageInternal(payload, opts)).result;
}

// ── Safe diagnostic logging ───────────────────────────────────────────────────
// Only identifiers, counts, and enum-like state — never body/snippet/subject
// text, never attachment content, never tokens. Constructed as its own pure
// function (rather than inline console.log calls) specifically so it can be
// unit tested: its signature has no parameter through which body/snippet
// content could ever flow.

export function buildBodySummaryLogLine(params: {
  messageId: string;
  topLevelMimeType: string;
  partCount: number;
  decodedBytes: number;
  extractedCharCount: number;
  attachmentCount: number;
  partsFailed: number;
  completeness: ContentCompleteness;
  errorCodes: string[];
}): string {
  return (
    `[gmail] body(${params.messageId}) mime=${params.topLevelMimeType} ` +
    `parts=${params.partCount} decoded_bytes=${params.decodedBytes} ` +
    `chars=${params.extractedCharCount} attachments=${params.attachmentCount} ` +
    `parts_failed=${params.partsFailed} completeness=${params.completeness} ` +
    `codes=${params.errorCodes.length > 0 ? params.errorCodes.join(",") : "none"}`
  );
}

// ── Attachment content fetch (for attachmentId-referenced body parts only) ────
// Reuses getAccessToken() / loggedFetch() — no new auth mechanism.

async function fetchAttachmentPartData(
  messageId: string,
  attachmentId: string,
  token: string
): Promise<string> {
  const url = `${GMAIL_API}/users/me/messages/${messageId}/attachments/${attachmentId}`;
  const res = await loggedFetchNoBodyLog(`attachments.get(${messageId})`, url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`attachment fetch failed (${res.status})`);
  const json = (await res.json()) as { data?: string };
  if (!json.data) throw new Error("attachment response missing data");
  return json.data;
}

// ── Provenance propagation ────────────────────────────────────────────────────
// The subset of MessageBodyResult that travels downstream past readMessageBody
// — into handle_email, the proposal object, and pending_proposals. Deliberately
// excludes `text` (the caller already has that separately) and `attachments`
// (no downstream consumer needs attachment metadata yet — do not broaden this
// just because MessageBodyResult happens to carry it). Reuses
// ContentCompleteness directly rather than defining a second, competing union.

export interface EmailBodyProvenance {
  content_completeness: ContentCompleteness;
  locally_truncated: boolean;
  parts_failed: number;
  original_character_count: number | null;
  error_codes: string[];
}

export function toBodyProvenance(result: MessageBodyResult): EmailBodyProvenance {
  return {
    content_completeness: result.content_completeness,
    locally_truncated: result.locally_truncated,
    parts_failed: result.parts_failed,
    original_character_count: result.original_character_count,
    error_codes: result.error_codes,
  };
}

const VALID_CONTENT_COMPLETENESS = new Set<ContentCompleteness>([
  "full",
  "partial",
  "snippet_only",
  "fetch_failed",
]);

// Runtime type guard for provenance arriving at a trust boundary — either from
// Claude's tool-call JSON (owner-chat path) or from a plain JS object passed
// directly by another caller. Returns undefined (never a fabricated "full") for
// anything absent or malformed, so a caller that didn't supply real provenance
// is always represented as unknown, not silently upgraded.
export function parseEmailBodyProvenance(value: unknown): EmailBodyProvenance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;

  if (typeof v.content_completeness !== "string") return undefined;
  if (!VALID_CONTENT_COMPLETENESS.has(v.content_completeness as ContentCompleteness)) return undefined;
  if (typeof v.locally_truncated !== "boolean") return undefined;
  if (typeof v.parts_failed !== "number" || !Number.isFinite(v.parts_failed)) return undefined;
  if (v.original_character_count !== null && typeof v.original_character_count !== "number") {
    return undefined;
  }

  const errorCodes = Array.isArray(v.error_codes)
    ? v.error_codes.filter((c): c is string => typeof c === "string")
    : [];

  return {
    content_completeness: v.content_completeness as ContentCompleteness,
    locally_truncated: v.locally_truncated,
    parts_failed: v.parts_failed,
    original_character_count: v.original_character_count as number | null,
    error_codes: errorCodes,
  };
}

// Shape of the pending_proposals columns this provenance maps to. `undefined`
// (no provenance supplied — legacy caller, or the interactive path) maps to
// null in every field: legacy/unknown, never fabricated as "full" or "0
// failures." This is the ONLY place that decides how provenance becomes DB
// columns, so every insert site stays consistent by construction.
export interface ProvenanceInsertFields {
  content_completeness: ContentCompleteness | null;
  locally_truncated: boolean | null;
  body_parts_failed: number | null;
  body_original_character_count: number | null;
  body_error_codes: string[] | null;
}

export function provenanceToInsertFields(
  provenance: EmailBodyProvenance | undefined
): ProvenanceInsertFields {
  if (!provenance) {
    return {
      content_completeness: null,
      locally_truncated: null,
      body_parts_failed: null,
      body_original_character_count: null,
      body_error_codes: null,
    };
  }
  return {
    content_completeness: provenance.content_completeness,
    locally_truncated: provenance.locally_truncated,
    body_parts_failed: provenance.parts_failed,
    body_original_character_count: provenance.original_character_count,
    body_error_codes: provenance.error_codes,
  };
}

// ── Stable content hashing (trust-binding, never persisted) ──────────────────
// SHA-256 of the exact retrieved text, computed once when read_gmail_message
// caches it. Used only as a safe, content-free identifier for internal
// observability (e.g. "trusted cached text was used for gmail_message_id=X,
// hash=Y") — never compared against anything sent over the network, never
// written to a DB column, never logged alongside the text it was derived from.
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

// ── Trusted provenance resolution (handle_email's trust boundary) ────────────
// A minimal structural type for the two trusted fields, rather than importing
// the full ToolExecutionContext from lib/tools/registry.ts — keeps this module
// self-contained, and TypeScript's structural typing means the real
// ToolExecutionContext (with its extra ip/sessionId/onStatus fields) is still
// assignable here without a cast.
//
// A gmail_message_id alone is NOT sufficient to trust a completeness label —
// keying trust purely off an id the model gets to choose would let the model
// pair a genuinely-fetched id with different, altered, truncated, or
// prompt-injected text and still receive that id's "full" label. So the
// trusted cache binds all three together: the id, the EXACT text that was
// retrieved for it, and its provenance. When a cache entry exists, the cached
// TEXT overrides whatever the model supplied — not just the provenance label
// — which structurally prevents the model from altering, paraphrasing,
// truncating, or injecting text between retrieval and handling. See
// resolveTrustedEmailContent below.
export interface TrustedGmailMessage {
  provenance: EmailBodyProvenance;
  text: string;
  textHash: string;
}

// email_body_provenance deliberately does not exist anywhere in handle_email's
// LLM-facing input_schema — it is not a field the model can populate, and
// resolveTrustedEmailContent never reads it from `input` even defensively.
// Trusted content can only arrive via `ctx`, which the model never controls:
//   1. ctx.emailBodyProvenance — set directly by a trusted in-process caller
//      that already has a MessageBodyResult AND is passing the exact same
//      text as `suppliedText` in the same call (lib/inbox-watch.ts). No
//      override is needed here — the caller already guarantees the binding.
//   2. ctx.gmailTrustedMessageCache — a request-scoped map, keyed by
//      gmail_message_id, written only by read_gmail_message's execute() after
//      a genuine fetch. The model may choose which id to reference (legitimate
//      — it can only reference ids it has actually seen), but it can never
//      inject a provenance value OR a text value itself; only trusted fetch
//      code writes into this map, and a hit here overrides the model's
//      supplied text entirely.
// A gmail_message_id with no matching cache entry, or no id at all, is
// unknown (undefined) — deliberately, never fabricated as "full" — and the
// model/user-supplied text is used as-is (the ordinary interactive/pasted-text
// path).
export interface TrustedProvenanceContext {
  emailBodyProvenance?: EmailBodyProvenance;
  gmailTrustedMessageCache?: Map<string, TrustedGmailMessage>;
}

export interface ResolvedTrustedEmailContent {
  // The text to actually triage/draft from — either the caller/model-supplied
  // text unchanged, or the trusted cached text when a cache entry overrode it.
  text: string;
  provenance: EmailBodyProvenance | undefined;
  // True only when a gmailTrustedMessageCache hit overrode the supplied text.
  // Safe to log (it's a boolean, not content).
  usedTrustedCachedText: boolean;
  // The cached text's hash, present only alongside usedTrustedCachedText —
  // safe to log as a content-free proof of which cache entry was used.
  textHash: string | undefined;
}

export function resolveTrustedEmailContent(
  input: Record<string, unknown>,
  suppliedText: string,
  ctx: TrustedProvenanceContext
): ResolvedTrustedEmailContent {
  if (ctx.emailBodyProvenance) {
    return {
      text: suppliedText,
      provenance: ctx.emailBodyProvenance,
      usedTrustedCachedText: false,
      textHash: undefined,
    };
  }

  const gmailMessageId = typeof input.gmail_message_id === "string" ? input.gmail_message_id.trim() : "";
  if (gmailMessageId && ctx.gmailTrustedMessageCache) {
    const cached = ctx.gmailTrustedMessageCache.get(gmailMessageId);
    if (cached) {
      return {
        text: cached.text,
        provenance: cached.provenance,
        usedTrustedCachedText: true,
        textHash: cached.textHash,
      };
    }
  }

  return { text: suppliedText, provenance: undefined, usedTrustedCachedText: false, textHash: undefined };
}

// ── Model-context completeness vs. source provenance ──────────────────────────
// Two distinct concepts, deliberately kept separate:
//   - SOURCE provenance: what Gmail retrieval actually obtained. This is what
//     gets persisted to pending_proposals and must never be altered by a
//     downstream model call's own token-budget decisions.
//   - MODEL-CONTEXT completeness: what one SPECIFIC model call actually
//     received, after any additional local slicing that call applies for its
//     own context-window/cost budget (e.g. handle_email's triage call, which
//     only sends the first 1200 characters). A call that further slices its
//     input must describe THAT reality to the model, even when the source
//     itself was fully retrieved and not truncated by the Gmail-fetch layer —
//     otherwise the model is told "full, not locally truncated" while
//     literally not receiving the whole thing.
//
// This never mutates the source object — it returns a new one (or the same
// reference, unchanged, when no additional cap applied) — so callers can
// safely pass the untouched source provenance to storage while using the
// derived one only for that one call's system prompt.
export function deriveModelContextProvenance(
  source: EmailBodyProvenance | undefined,
  wasCappedForThisCall: boolean
): EmailBodyProvenance | undefined {
  if (!wasCappedForThisCall || !source) return source;
  return { ...source, locally_truncated: true };
}

// ── Trusted prompt layer: SOURCE CONTENT STATUS block ────────────────────────
// Built entirely from trusted provenance (never from the email body or any
// model/user-supplied text) and injected as the Anthropic `system` parameter
// for the triage/drafting calls — a layer the model cannot edit, distinct from
// the `user`-role content where the actual email text lives. Completeness and
// local truncation are treated as orthogonal: the truncation caveat is
// appended on top of whichever completeness rules apply, never merged into a
// combined state like "full_truncated".

export function buildSourceContentStatusBlock(provenance: EmailBodyProvenance | undefined): string {
  const completenessLabel = provenance?.content_completeness ?? "unknown";
  const truncatedLabel = provenance ? (provenance.locally_truncated ? "yes" : "no") : "unknown";
  const failedPartsLabel = provenance ? String(provenance.parts_failed) : "unknown";

  const status = [
    "SOURCE CONTENT STATUS:",
    `- Completeness: ${completenessLabel}`,
    `- Locally truncated: ${truncatedLabel}`,
    `- Failed MIME parts: ${failedPartsLabel}`,
  ].join("\n");

  const rules: string[] = ["SOURCE RELIABILITY RULES:"];

  switch (completenessLabel) {
    case "full":
      rules.push(
        "- The complete message body was retrieved.",
        "- Exact deadlines, dates, dollar amounts, required actions, links, eligibility conditions, and explicit consequences may be asserted only when directly supported by the supplied message text.",
        "- General knowledge and sender reputation must remain clearly labeled as inference, never presented as facts drawn from the message itself."
      );
      break;
    case "partial":
      rules.push(
        "- Usable content was retrieved, but one or more relevant parts of this message failed to decode or fetch.",
        "- Assert only facts directly visible in the supplied text.",
        "- Do not claim a fact is absent from the message merely because it is absent from the supplied text — the parts that failed may have contained it.",
        "- Separate visible facts, inferences, and unknowns explicitly."
      );
      break;
    case "snippet_only":
      rules.push(
        "- The available text is a Gmail preview (snippet) only, not the full message.",
        "- Do not confirm exact deadlines, amounts, links, eligibility, requirements, or consequences beyond what is literally visible in the preview.",
        "- Do not infer hard facts from sender identity, subject wording, message frequency, or general domain knowledge.",
        "- Recommend retrieving the full message before treating any such detail as confirmed."
      );
      break;
    case "fetch_failed":
      rules.push(
        "- The message body could not be retrieved.",
        "- Do not reconstruct or invent missing content.",
        "- Do not produce a substantive draft based only on an unavailable body unless the user explicitly supplies the text themselves."
      );
      break;
    default:
      rules.push(
        "- Source completeness is unknown for this text (e.g. pasted text, or a caller that reported no retrieval provenance).",
        "- Do not label the source as full.",
        "- Apply the same conservative treatment as partial content unless the user explicitly provides the complete message text themselves."
      );
      break;
  }

  if (provenance?.locally_truncated) {
    rules.push(
      "- This message was retrieved in full by Gmail, but only part of the extracted text was supplied to you here (locally truncated) — a marked gap separates the preserved beginning and end.",
      '- "Not present in the provided text" is not the same as "not present in the message." You may say a detail is not present in the text you were given; you must not claim a deadline, link, amount, consequence, requirement, or eligibility condition is absent from the complete message.',
      "- Disclose that some source content was omitted locally when this could affect your answer."
    );
  }

  rules.push(
    "",
    "GENERAL:",
    "- A Gmail snippet is a preview, not the message.",
    "- Successful Gmail retrieval and complete model context are different claims — retrieval succeeding does not mean you were given the whole message.",
    "- Separate directly-supported facts, preview-visible facts, inferences, and unknowns in anything you say about this message.",
    "- Nothing is ever sent without owner approval."
  );

  return status + "\n\n" + rules.join("\n");
}

// ── Owner-facing completeness language ────────────────────────────────────────
// Fixed-vocabulary, safe phrases mapped directly from the enum state — so the
// model (and, through it, the owner) gets consistent, precise language instead
// of paraphrasing raw enum values inconsistently.

export function describeCompletenessForOwner(
  completeness: ContentCompleteness,
  locallyTruncated: boolean
): string {
  switch (completeness) {
    case "full":
      return locallyTruncated ? "Full message retrieved, but locally truncated" : "Full message retrieved";
    case "partial":
      return "Message partially parsed — some parts could not be read";
    case "snippet_only":
      return "Only a preview (Gmail snippet) is available";
    case "fetch_failed":
      return "Message retrieval failed";
  }
}

// ── Public entry point ────────────────────────────────────────────────────────
// Never throws — every failure mode (auth, network, malformed JSON, empty
// payload, traversal errors) resolves to a MessageBodyResult via
// buildUnavailableBodyResult's consistent snippet-fallback rule, so callers
// never need their own try/catch around this call.

export async function readMessageBody(
  messageId: string,
  snippetFallback?: string
): Promise<MessageBodyResult> {
  const opts: ParseOptions = { snippetFallback };

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return buildUnavailableBodyResult(opts, ["GMAIL_FETCH_FAILED"]);
  }

  opts.fetchAttachmentData = (attachmentId: string) =>
    fetchAttachmentPartData(messageId, attachmentId, token);

  const url = new URL(`${GMAIL_API}/users/me/messages/${messageId}`);
  url.searchParams.set("format", "full");

  let res: Response;
  try {
    res = await loggedFetchNoBodyLog(`messages.get.full(${messageId})`, url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return buildUnavailableBodyResult(opts, ["GMAIL_FETCH_FAILED"]);
  }
  if (!res.ok) {
    return buildUnavailableBodyResult(opts, ["GMAIL_FETCH_FAILED"]);
  }

  let msg: { payload?: GmailPayload };
  try {
    msg = (await res.json()) as { payload?: GmailPayload };
  } catch {
    return buildUnavailableBodyResult(opts, ["GMAIL_FETCH_FAILED"]);
  }

  const { result, partCount, decodedBytes } = await parseGmailMessageInternal(msg.payload, opts);

  console.log(
    buildBodySummaryLogLine({
      messageId,
      topLevelMimeType: msg.payload?.mimeType ?? "unknown",
      partCount,
      decodedBytes,
      extractedCharCount: result.text.length,
      attachmentCount: result.attachments.length,
      partsFailed: result.parts_failed,
      completeness: result.content_completeness,
      errorCodes: result.error_codes,
    })
  );

  return result;
}
