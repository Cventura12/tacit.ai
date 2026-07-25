import type { APIRoute } from "astro";
import { randomBytes } from "crypto";
import { buildConsentUrl } from "@/lib/gmail";

export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export const GET: APIRoute = ({ cookies, redirect }) => {
  const state = randomBytes(16).toString("hex");
  const consentUrl = buildConsentUrl(state);

  cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return redirect(consentUrl);
};
