// Auth removed — this app is local-only (127.0.0.1), no public access.
// Middleware is a no-op; the matcher is empty so it never runs.

import { NextResponse } from "next/server";

export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
