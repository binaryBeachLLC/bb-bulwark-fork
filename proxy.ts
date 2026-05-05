import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { getEnabledPluginFrameOrigins } from "./lib/admin/csp-frame-origins";
import {
  EDGE_SUB_COOKIE,
  EDGE_HEADER,
  edgeCookieOptions,
} from "./lib/auth/bb-edge-identity";
import { refreshTokenCookieName } from "./lib/oauth/tokens";

const intlMiddleware = createIntlMiddleware(routing);

// Next 16's Proxy always runs on Node.js runtime and route-segment config
// (e.g. `export const config = { matcher }`) is no longer allowed in the
// proxy file. We replicate the previous matcher inline by short-circuiting
// requests for API routes, Next internals and static assets.
const PROXY_SKIP_PATTERN = /^\/(?:api|_next)(?:\/|$)|\.[^/]+$/;

// binarybeachio (mine.9): per-app edge-identity validation. The marker
// cookie `_bb_edge_sub` is set at OIDC callback to the value of
// X-Auth-Request-User; on every authenticated request we re-check that
// the edge identity hasn't swapped under a still-valid Bulwark session.
// Mismatch -> clear all session-bearing cookies and 302 to / so the SPA
// reboots against the new edge identity. See
// docs/conventions/per-app-edge-identity-validation.md.
//
// Skip-paths: the edge check runs BEFORE the existing PROXY_SKIP_PATTERN
// short-circuit so it can guard /api/* state-bearing routes too. Routes
// that mint or rotate the session itself (the OIDC handshake), the admin
// password-gated surface (separate identity domain), the healthcheck, the
// runtime config endpoint (read pre-login), and locale-prefixed login +
// auth-callback pages all skip.
const EDGE_SKIP_SEGMENT_PREFIXES: readonly string[] = [
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.json",
  "/sw.js",
  "/branding",
  "/public",
  "/api/health",
  "/api/config",
  "/api/auth/sso/start",          // POST start (classic flow)
  "/api/auth/sso/start-redirect", // GET start (bridge bypass; mine.8)
  "/api/auth/sso/complete",
  "/api/auth/token",              // POST mint, PUT refresh, DELETE revoke
  "/api/auth/session",            // basic-auth break-glass session
  "/api/admin",                   // admin uses its own password-gated session
  "/admin",
  "/jmap-proxy",                  // Stalwart bearer traffic, not Bulwark sessions
  "/api/auth/stalwart-context",
];

const EDGE_SKIP_LOOSE_PREFIXES: readonly string[] = ["/workbox-"];

const EDGE_LOCALE_PRE_AUTH_RE =
  /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/(?:login|auth\/callback)(?:\/|$)/;

function shouldSkipEdgeCheck(pathname: string): boolean {
  if (EDGE_LOCALE_PRE_AUTH_RE.test(pathname)) return true;
  for (const p of EDGE_SKIP_SEGMENT_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  for (const p of EDGE_SKIP_LOOSE_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

function enforceEdgeIdentity(request: NextRequest): NextResponse | null {
  if (shouldSkipEdgeCheck(request.nextUrl.pathname)) return null;

  const edgeSub = request.headers.get(EDGE_HEADER);
  if (!edgeSub) {
    // No oauth2-proxy header — request didn't flow through the edge gate
    // (mobile bearer-token, dev, or break-glass mode). Pass through.
    return null;
  }

  const cookieSub = request.cookies.get(EDGE_SUB_COOKIE)?.value;

  if (!cookieSub) {
    // Legacy session minted before mine.9 OR the request hit a guarded
    // path before the OIDC callback could pin the cookie. Lazy-populate
    // so subsequent requests are guarded; don't force a re-login.
    const res = NextResponse.next();
    res.cookies.set(EDGE_SUB_COOKIE, edgeSub, edgeCookieOptions());
    return res;
  }

  if (cookieSub === edgeSub) return null;

  // Mismatch: edge identity has swapped (user invoked
  // bridge.binarybeach.io/logout then signed back in as a different
  // identity, OR the operator deactivated and recreated the user). Clear
  // every Bulwark-side session cookie and bounce to `/` so the SPA reboots
  // against the fresh edge identity. The bulwark-signin-redirect Traefik
  // middleware will handle re-auth from there.
  const res = NextResponse.redirect(new URL("/", request.url));
  res.cookies.delete(EDGE_SUB_COOKIE);
  for (let slot = 0; slot <= 4; slot++) {
    res.cookies.delete(refreshTokenCookieName(slot));
  }
  return res;
}

export async function proxy(request: NextRequest) {
  const edgeResponse = enforceEdgeIdentity(request);
  if (edgeResponse) return edgeResponse;

  if (PROXY_SKIP_PATTERN.test(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const nonce = crypto.randomUUID();
  const isDev = process.env.NODE_ENV === "development";

  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-eval' blob:`
    : `'self' 'nonce-${nonce}' blob:`;

  const connectSrc = isDev ? `'self' http: https: ws: wss:` : `'self' https:`;

  const frameAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim() || "'none'";

  // Plugins may declare iframe origins they need (e.g. for embedded video).
  // Each origin is validated at install time and re-validated here.
  const pluginFrameOrigins = await getEnabledPluginFrameOrigins();
  const frameSrc =
    pluginFrameOrigins.length > 0
      ? `frame-src 'self' blob: ${pluginFrameOrigins.join(" ")}`
      : `frame-src 'self' blob:`;

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    frameSrc,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors ${frameAncestors}`,
    `media-src 'self' blob:`,
  ].join("; ");

  // Skip intl middleware for /admin routes - they have their own layout
  const pathname = request.nextUrl.pathname;
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');

  // When localePrefix is 'always', paths that already have a locale prefix
  // (e.g. /en/settings) should not be re-processed by the intl middleware -
  // doing so can trigger rewrite loops when combined with a proxy basePath.
  const locales = routing.locales as readonly string[];
  const hasLocalePrefix = locales.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
  );

  let intlResponse: ReturnType<typeof intlMiddleware> | null = null;
  if (!isAdminRoute && !hasLocalePrefix) {
    try {
      intlResponse = intlMiddleware(request);
    } catch (error) {
      console.error('Locale middleware error:', error);
    }
  }
  const response = intlResponse ?? NextResponse.next();

  const existing = response.headers.get("x-middleware-override-headers");
  response.headers.set(
    "x-middleware-override-headers",
    existing ? `${existing},x-nonce` : "x-nonce"
  );
  response.headers.set("x-middleware-request-x-nonce", nonce);

  response.headers.set("X-Content-Type-Options", "nosniff");

  // X-Frame-Options only supports DENY/SAMEORIGIN. When frame-ancestors
  // specifies explicit origins, we rely solely on the CSP header.
  if (frameAncestors === "'none'") {
    response.headers.set("X-Frame-Options", "DENY");
  }

  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-XSS-Protection", "0");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  response.headers.set("Content-Security-Policy", csp);

  return response;
}
