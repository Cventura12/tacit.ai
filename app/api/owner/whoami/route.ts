import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// DIAGNOSTIC ONLY — deliberately does NOT use requireOwner(). requireOwner()
// returns 403 (not the userId) when the session doesn't match
// OWNER_CLERK_USER_ID, which would defeat the one thing this route exists
// for: letting the owner see what userId their own live session actually
// resolves to, so it can be compared against OWNER_CLERK_USER_ID and against
// the owner_id already stored on rows in the database. Any authenticated
// Clerk session may hit this; it reveals nothing but that session's own id.

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ userId });
}
