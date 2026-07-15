import { NextRequest, NextResponse } from "next/server";
import { saveRefreshTokenFromCode } from "@/lib/gmail";
import { logOwnerAction } from "@/lib/owner-actions";
import { GMAIL_OAUTH_STATE_COOKIE } from "../connect/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerRedirect(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/owner", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  // No session check here — the strict sameSite cookie won't survive a
  // cross-site redirect from Google. Security is provided by the CSRF state
  // cookie (sameSite: lax) verified below: its presence proves this callback
  // was initiated by someone who held a valid owner session.
  const { searchParams } = req.nextUrl;
  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Google returned an error (e.g. access_denied)
  if (error) {
    return ownerRedirect(req, { gmail: "error", reason: error });
  }

  // Verify CSRF state
  const savedState = req.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  if (!state || !savedState || state !== savedState) {
    return ownerRedirect(req, { gmail: "error", reason: "state_mismatch" });
  }

  if (!code) {
    return ownerRedirect(req, { gmail: "error", reason: "missing_code" });
  }

  try {
    await saveRefreshTokenFromCode(code);
    void logOwnerAction("gmail_connected", {});
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.error("[gmail/callback] saveRefreshTokenFromCode failed:", reason);
    const res = ownerRedirect(req, { gmail: "error", reason: "token_exchange_failed" });
    res.cookies.delete(GMAIL_OAUTH_STATE_COOKIE);
    return res;
  }

  const res = ownerRedirect(req, { gmail: "connected" });
  res.cookies.delete(GMAIL_OAUTH_STATE_COOKIE);
  return res;
}
