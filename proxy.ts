import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only the sign-in flow is public; everything else requires authentication.
const isPublic = createRouteMatcher(["/sign-in(.*)"]);

// Next.js 16 uses proxy.ts (not middleware.ts) with a named "proxy" export.
export const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    // Redirects unauthenticated browser requests to /sign-in.
    // API routes that reach a handler are also guarded by requireOwner()
    // which returns a clean 401/403 JSON response instead of a redirect.
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
