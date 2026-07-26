// Gmail integration — server-side only.
// Uses plain fetch to the Gmail REST API. No googleapis SDK, no new packages.
// SCOPES: gmail.readonly (read inbox) + gmail.send (send on behalf of owner).

import { randomBytes } from "crypto";
import { encryptCredential, decryptCredential, maskCredential } from "@/lib/crypto";
import { getDb, isDbConfigured } from "@/lib/db";

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

  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);

  const body = (await res.json()) as { access_token?: string; error?: string };
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
