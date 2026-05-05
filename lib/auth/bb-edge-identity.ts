// binarybeachio (mine.9): per-app edge-identity validation marker cookie.
// See docs/conventions/per-app-edge-identity-validation.md in the
// binarybeachio repo. Net-new file; nothing upstream depends on it.

export const EDGE_SUB_COOKIE = '_bb_edge_sub';
export const EDGE_HEADER = 'x-auth-request-user';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
};

export function edgeCookieOptions() {
  return COOKIE_OPTIONS;
}
