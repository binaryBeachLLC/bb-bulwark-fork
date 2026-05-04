// binarybeachio (mine.8): server-side GET-302 OIDC initiator. Mirrors the
// existing POST /api/auth/sso/start handler but answers a browser GET with a
// direct redirect to the IdP's authorize URL — no JSON, no React, no
// useEffect race. Used by the binarybeachio auth-bridge's bulwark adapter
// (infrastructure/auth-bridge/src/adapters/bulwark.ts) so the user is sent
// straight from the bridge to Zitadel without ever rendering Bulwark's
// /<locale>/login page.
//
// Why a separate file instead of adding GET to the existing route.ts:
//   - The POST handler validates a JSON body (redirect_uri, locale) and
//     returns JSON. Combining GET+POST would either branch awkwardly on
//     `request.method` or require splitting the helper anyway. Two files,
//     one shape each, mirrors how listmonk's mine.4 patch added /auth/oidc/start
//     as a sibling to /auth/oidc.
//
// Cookie behavior:
//   The `sso_pending` cookie set here MUST be readable when the browser
//   lands back on /<locale>/auth/callback?code=...&state=... and that page
//   POSTs to /api/auth/sso/complete. Both endpoints use the same
//   getCookieOptions() helper, so a single SameSite=None+Secure cookie set
//   here survives the round-trip via Zitadel.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { encryptPayload } from '@/lib/auth/crypto';
import { generateCodeVerifierServer, generateCodeChallengeServer, generateStateServer } from '@/lib/oauth/pkce-server';
import { getRequiredConfig } from '@/lib/oauth/token-exchange';
import { discoverOAuth } from '@/lib/oauth/discovery';
import { OAUTH_SCOPES } from '@/lib/oauth/tokens';
import { getCookieOptions } from '@/lib/oauth/cookie-config';
import { readFileEnv } from '@/lib/read-file-env';

const SSO_PENDING_COOKIE = 'sso_pending';
const SSO_PENDING_MAX_AGE = 300; // 5 minutes — matches POST /api/auth/sso/start.

const DEFAULT_LOCALE = 'en';
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

export async function GET(request: NextRequest) {
  try {
    if (!process.env.SESSION_SECRET && !readFileEnv(process.env.SESSION_SECRET_FILE)) {
      return NextResponse.json({ error: 'SESSION_SECRET is required for SSO' }, { status: 500 });
    }

    // Reverse-proxy-aware origin computation. Same logic as the mine.4 patch
    // on the POST route: prefer the explicit Origin header, then the
    // X-Forwarded-* pair, then the bogus container-bind fallback. The actual
    // security boundary is Zitadel's pre-registered redirect_uri allowlist.
    const headerOrigin = request.headers.get('origin');
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const requestOrigin = headerOrigin
      ?? (forwardedHost ? `${forwardedProto}://${forwardedHost}` : null)
      ?? request.nextUrl.origin;

    // Locale comes from a query param (the bridge's bulwark adapter passes
    // it). Constrain to ISO-ish two-letter codes (with optional region) so a
    // hostile caller can't smuggle path segments into the redirect_uri.
    const rawLocale = request.nextUrl.searchParams.get('locale') ?? DEFAULT_LOCALE;
    const locale = LOCALE_RE.test(rawLocale) ? rawLocale : DEFAULT_LOCALE;

    // Bulwark's auth callback page lives at /<locale>/auth/callback.
    // Compose the redirect_uri server-side; the value MUST match one of
    // the URIs registered on the Zitadel app.
    const redirect_uri = `${requestOrigin}/${locale}/auth/callback`;

    const { clientId, discoveryUrl } = getRequiredConfig();
    const metadata = await discoverOAuth(discoveryUrl);

    if (!metadata?.authorization_endpoint) {
      return NextResponse.json({ error: 'OAuth discovery failed' }, { status: 502 });
    }

    const codeVerifier = generateCodeVerifierServer();
    const codeChallenge = generateCodeChallengeServer(codeVerifier);
    const state = generateStateServer();

    const pendingData = {
      state,
      code_verifier: codeVerifier,
      redirect_uri,
      created_at: Date.now(),
    };
    const encrypted = encryptPayload(pendingData);

    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirect_uri);
    authUrl.searchParams.set('scope', OAUTH_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('ui_locales', locale);

    // Forward optional OAUTH_AUTH_PROMPT (mirrors the POST route's mine.2
    // patch) so deployments can force `prompt=select_account` etc.
    const promptParam = process.env.OAUTH_AUTH_PROMPT;
    if (promptParam) {
      authUrl.searchParams.set('prompt', promptParam);
    }

    // Build the redirect response and attach the sso_pending cookie via
    // response headers. NextResponse.cookies.set() takes the same attribute
    // set as the POST route's cookieStore.set() with options. Note the spread
    // order: cookieOpts has its own `maxAge` (30 days, intended for the
    // long-lived refresh-token cookie), so we override after the spread so
    // sso_pending stays short-lived.
    const response = NextResponse.redirect(authUrl.toString(), 302);
    const cookieOpts = getCookieOptions();
    response.cookies.set({
      name: SSO_PENDING_COOKIE,
      value: encrypted,
      ...cookieOpts,
      maxAge: SSO_PENDING_MAX_AGE,
    });
    return response;
  } catch (error) {
    logger.error('SSO start-redirect error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
