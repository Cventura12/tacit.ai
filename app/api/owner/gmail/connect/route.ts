import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { buildConsentUrl } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exported so the callback route can import it rather than duplicating the string.
export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = randomBytes(16).toString("hex");
  const consentUrl = buildConsentUrl(state);

  const res = NextResponse.redirect(consentUrl);
  res.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must be lax — Google redirects back cross-site
    maxAge: 600,
    path: "/",
  });
  return res;
}
