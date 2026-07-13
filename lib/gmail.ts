// Gmail read-only integration — server-side only.
// Uses plain fetch to the Gmail REST API. No googleapis SDK, no new packages.
// SCOPE: gmail.readonly — this file must never send, delete, or modify mail.

import { encryptCredential, decryptCredential, maskCredential } from "@/lib/crypto";
import { getDb, isDbConfigured } from "@/lib/db";

export const GMAIL_CONNECTOR_ID = "00000000-0000-0000-0000-000000000003";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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
      name: "Gmail (read-only)",
      description: "Read your Gmail inbox as owner. Never sends, deletes, or modifies mail.",
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
