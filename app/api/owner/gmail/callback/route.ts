import { type NextRequest, NextResponse } from "next/server";
import { saveRefreshTokenFromCode } from "@/lib/gmail";
import { logOwnerAction } from "@/lib/owner-actions";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export async function GET(request: NextRequest) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  function ownerRedirect(params: Record<string, string>) {
    const dest = new URL("/", url.origin);
    for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
    const res = NextResponse.redirect(dest.toString());
    res.cookies.delete(GMAIL_OAUTH_STATE_COOKIE);
    return res;
  }

  if (error) {
    return ownerRedirect({ gmail: "error", reason: error });
  }

  const savedState = request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  if (!state || !savedState || state !== savedState) {
    return ownerRedirect({ gmail: "error", reason: "state_mismatch" });
  }

  if (!code) {
    return ownerRedirect({ gmail: "error", reason: "missing_code" });
  }

  try {
    await saveRefreshTokenFromCode(code);
    void logOwnerAction("gmail_connected", {});
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.error("[gmail/callback] saveRefreshTokenFromCode failed:", reason);
    return ownerRedirect({ gmail: "error", reason: "token_exchange_failed" });
  }

  return ownerRedirect({ gmail: "connected" });
}
