// binarybeachio (mine.9): per-app edge-identity validation middleware.
// See docs/conventions/per-app-edge-identity-validation.md in the
// binarybeachio repo. Net-new file; no upstream code is modified.
//
// What it does: when oauth2-proxy injects `X-Auth-Request-User` (the Zitadel
// `sub`), compare it to the `_bb_edge_sub` cookie that was pinned at
// OIDC-callback time. On mismatch, clear the per-account refresh-token
// cookies and the marker cookie, then redirect to `/` so the SPA reboots
// against the new edge identity. On missing cookie (legacy session pre-
// dating this patch), lazy-populate. On missing header (mobile / break-glass
// without the edge gate), pass through.

import { NextResponse, type NextRequest } from 'next/server';
import { EDGE_SUB_COOKIE, EDGE_HEADER, edgeCookieOptions } from '@/lib/auth/bb-edge-identity';
import { refreshTokenCookieName } from '@/lib/oauth/tokens';

// Path prefixes that skip the edge-identity check. Each entry matches the
// path exactly OR as a `/`-bounded segment prefix (`/admin` matches `/admin`
// and `/admin/x` but NOT `/administrator`).
const SKIP_SEGMENT_PREFIXES: readonly string[] = [
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/manifest.json',
  '/sw.js',
  '/branding',
  '/public',
  '/api/health',
  '/api/config',
  '/api/auth/sso/start',          // POST start (classic flow)
  '/api/auth/sso/start-redirect', // GET start (bridge bypass; mine.8)
  '/api/auth/sso/complete',
  '/api/auth/token',              // POST mint, PUT refresh, DELETE revoke
  '/api/auth/session',            // basic-auth break-glass session
  '/api/admin',                   // admin uses its own password-gated session
  '/admin',
  '/jmap-proxy',                  // Stalwart bearer traffic, not Bulwark sessions
  '/api/auth/stalwart-context',
];

// Loose prefixes: match anything that starts with the string.
const SKIP_LOOSE_PREFIXES: readonly string[] = [
  '/workbox-',
];

// Locale-prefixed pre-auth pages: `/<locale>/login`, `/<locale>/auth/callback`,
// and the bare `/login`. Locale = lowercase 2-letter, optional region.
const LOCALE_PRE_AUTH_RE = /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/(?:login|auth\/callback)(?:\/|$)/;

function shouldSkip(pathname: string): boolean {
  if (LOCALE_PRE_AUTH_RE.test(pathname)) return true;
  for (const p of SKIP_SEGMENT_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + '/')) return true;
  }
  for (const p of SKIP_LOOSE_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

export function middleware(request: NextRequest) {
  if (shouldSkip(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const edgeSub = request.headers.get(EDGE_HEADER);
  if (!edgeSub) {
    // No oauth2-proxy header — request didn't flow through the edge gate
    // (mobile bearer-token, dev, or break-glass mode). Pass through.
    return NextResponse.next();
  }

  const cookieSub = request.cookies.get(EDGE_SUB_COOKIE)?.value;

  if (!cookieSub) {
    // Legacy session minted before mine.9 OR the request hit a middleware-
    // gated path before the OIDC callback could pin the cookie. Lazy-populate
    // so subsequent requests are guarded; don't force a re-login.
    const res = NextResponse.next();
    res.cookies.set(EDGE_SUB_COOKIE, edgeSub, edgeCookieOptions());
    return res;
  }

  if (cookieSub === edgeSub) {
    return NextResponse.next();
  }

  // Mismatch: edge identity has swapped (user invoked
  // bridge.binarybeach.io/logout then signed back in as a different
  // identity, OR the operator deactivated and recreated the user). Clear
  // every Bulwark-side session cookie and bounce to `/` so the SPA reboots
  // against the fresh edge identity. The bulwark-signin-redirect Traefik
  // middleware will handle re-auth from there.
  const res = NextResponse.redirect(new URL('/', request.url));
  res.cookies.delete(EDGE_SUB_COOKIE);
  for (let slot = 0; slot <= 4; slot++) {
    res.cookies.delete(refreshTokenCookieName(slot));
  }
  return res;
}

// Run on every request; per-path skip logic lives in shouldSkip() above.
// Excluding _next/static here as well to spare the runtime even invoking
// middleware on bundled assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
