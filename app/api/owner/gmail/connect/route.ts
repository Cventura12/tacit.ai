import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildConsentUrl } from "@/lib/gmail";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export async function GET() {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const state = randomBytes(16).toString("hex");
  const consentUrl = buildConsentUrl(state);

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
