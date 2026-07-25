// Session management — stateless JWT signed with SESSION_SECRET.
// jose is used because it works in both Node.js and Edge runtimes.
// The token is stored in an HttpOnly, Secure, SameSite=Strict cookie —
// never accessible from client-side JavaScript.

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "caleb_ai_owner_session";
const ALGORITHM = "HS256";
// 30 days in seconds — long-lived for single-user local use
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ owner: true })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(signingKey());
}

// Returns true only if the token is present, validly signed, and not expired.
// Swallows all jose errors (expired, tampered, missing) and returns false.
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: [ALGORITHM],
    });
    return payload.owner === true;
  } catch {
    return false;
  }
}

// Cookie attributes applied both when setting and when reading spec requirements.
// secure: true always — caleb.ai is HTTPS in production, and localhost dev
// browsers accept Secure cookies on 127.0.0.1.
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  maxAge: SESSION_MAX_AGE,
  path: "/",
};
