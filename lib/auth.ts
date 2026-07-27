// Server-side owner guard. Import and call at the top of every protected route.
// Two-layer check: (1) Clerk authentication, (2) exact user-ID match.
// Fails closed: if OWNER_CLERK_USER_ID is not configured, all access is denied.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export type OwnerCheck =
  | { ok: true;  userId: string }
  | { ok: false; response: NextResponse };

export async function requireOwner(): Promise<OwnerCheck> {
  const { userId } = await auth();

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const ownerId = process.env.OWNER_CLERK_USER_ID;
  if (!ownerId || userId !== ownerId) {
    console.warn(`[auth] 403 — userId=${userId} is not the owner`);
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, userId };
}
