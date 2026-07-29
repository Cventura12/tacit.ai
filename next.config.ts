import type { NextConfig } from "next";
import path from "path";

// Clerk domain groups — sourced from @clerk/nextjs ContentSecurityPolicyDirectiveManager.DEFAULT_DIRECTIVES
// plus the instance-specific frontend-API origin (*.clerk.accounts.dev) which Clerk injects
// dynamically when using its own CSP helper but must be listed explicitly in a static header.
const CLERK_ACCOUNTS   = "https://*.clerk.accounts.dev"; // instance JS bundle + API calls
const CLERK_PROTECT    = "https://*.protect.clerk.com";  // bot-protection challenges
const CLERK_TELEMETRY  = "https://clerk-telemetry.com https://*.clerk-telemetry.com";
const CLERK_IMG        = "https://img.clerk.com https://images.clerkstage.dev";
const CF_TURNSTILE     = "https://challenges.cloudflare.com"; // Clerk CAPTCHA — script, frame, connect

const ContentSecurityPolicy = [
  "default-src 'self'",

  // Clerk loads its JS from the instance's frontend-API subdomain (*.clerk.accounts.dev).
  // 'unsafe-inline' is needed for Next.js inline scripts; 'unsafe-eval' is excluded intentionally.
  `script-src 'self' 'unsafe-inline' ${CLERK_ACCOUNTS} ${CLERK_PROTECT} ${CF_TURNSTILE}`,

  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,

  // Clerk profile images and component assets.
  `img-src 'self' data: blob: ${CLERK_IMG}`,

  // Clerk session sync, token refresh, and telemetry all go to these origins.
  `connect-src 'self' ${CLERK_ACCOUNTS} ${CLERK_PROTECT} ${CLERK_TELEMETRY} ${CLERK_IMG} ${CF_TURNSTILE}`,

  // Clerk uses blob: Web Workers for some auth flows (from DEFAULT_DIRECTIVES).
  "worker-src 'self' blob:",

  // Clerk's CAPTCHA/protection challenge iframes.
  `frame-src 'self' https://challenges.cloudflare.com ${CLERK_PROTECT}`,

  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    // Next.js intercepts all multipart/form-data POSTs (including route handlers) through
    // the Server Action body-size gate. The default is 1MB; raise it to match the route
    // handler's own MAX_BYTES limit so large PDF uploads are not rejected before they arrive.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Keep heavy native modules out of the Webpack/Turbopack bundle.
  // Equivalent to Astro's ssr.external — let Node load them directly.
  serverExternalPackages: [
    "@napi-rs/canvas",
    "tesseract.js",
    "pdf-parse",
    "pdfjs-dist",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: ContentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
