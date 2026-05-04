// binarybeachio (mine.5): added `offline_access` so Zitadel issues a refresh
// token alongside the access token. Without it, every page refresh forces a
// full re-auth because Bulwark's `/api/auth/token PUT` finds no `jmap_rt`
// cookie (which is only set when tokens.refresh_token is present in the
// initial code-exchange response). Pairs with a Zitadel-side change to add
// `OIDC_GRANT_TYPE_REFRESH_TOKEN` to the Stalwart app's grantTypes — both
// are required; either alone is a no-op.
const DEFAULT_SCOPES = 'openid email profile offline_access';
const EXTRA_SCOPES = process.env.OAUTH_EXTRA_SCOPES || '';
export const OAUTH_SCOPES = process.env.OAUTH_SCOPES || (EXTRA_SCOPES ? `${DEFAULT_SCOPES} ${EXTRA_SCOPES}`.trim() : DEFAULT_SCOPES);
export const REFRESH_TOKEN_COOKIE = 'jmap_rt';

/** Get the cookie name for a given account slot (0-4). Slot 0 uses the legacy name. */
export function refreshTokenCookieName(slot: number): string {
  return slot === 0 ? REFRESH_TOKEN_COOKIE : `${REFRESH_TOKEN_COOKIE}_${slot}`;
}
