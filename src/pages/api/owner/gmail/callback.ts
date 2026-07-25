import type { APIRoute } from "astro";
import { saveRefreshTokenFromCode } from "@/lib/gmail";
import { logOwnerAction } from "@/lib/owner-actions";

const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  function ownerRedirect(params: Record<string, string>) {
    const dest = new URL("/", url.origin);
    for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
    return redirect(dest.toString());
  }

  if (error) {
    return ownerRedirect({ gmail: "error", reason: error });
  }

  const savedState = cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
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
    cookies.delete(GMAIL_OAUTH_STATE_COOKIE, { path: "/" });
    return ownerRedirect({ gmail: "error", reason: "token_exchange_failed" });
  }

  cookies.delete(GMAIL_OAUTH_STATE_COOKIE, { path: "/" });
  return ownerRedirect({ gmail: "connected" });
};
