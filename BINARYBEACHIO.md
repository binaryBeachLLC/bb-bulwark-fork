# bb-bulwark-fork — binarybeachio Bulwark Webmail fork

This is the binarybeachio fork of [Bulwark Webmail](https://github.com/bulwarkmail/webmail) — a modern JMAP webmail client purpose-built for Stalwart Mail Server, written in Next.js. The fork exists primarily to **establish the build/release pipeline** for a service we self-host. As of `v1.6.0-mine.1` it ships with **zero functional patches** against upstream — every binarybeachio-specific knob (OIDC issuer, branding, JMAP target, telemetry) is exposed as a runtime env var on upstream's source, so the customization surface today is documentation only (`BINARYBEACHIO.md`, `.gitattributes`).

The fork is kept on the books because:

1. **Future patches.** When upstream lacks an env knob we need (e.g., a custom locale string, a deeper PWA branding override, or a Stalwart-specific behavior), having the build pipeline already wired means the patch is a one-line diff + tag bump — not a from-scratch fork dance.
2. **Off-site source archive (AGPL §13 compliance).** Bulwark is AGPL-3.0-only, and we serve it over the network at `mail.binarybeach.io` (planned). The Forgejo source-of-truth at `git.binarybeach.io/binarybeach/bb-bulwark-fork` plus the GitHub push-mirror at `github.com/binaryBeachLLC/bb-bulwark-fork` together satisfy AGPL's source-disclosure obligation for network use.
3. **Reproducible builds.** Pinning a specific upstream commit (here, tag `1.6.0`) and tagging the resulting image as `v1.6.0-mine.1` decouples our deploys from upstream's `:latest`. Upstream can ship `1.6.1` tomorrow; our deploy stays on `mine.1` until we deliberately bump.

If you're reading this on a future merge from upstream, the [Refresh from upstream](#refresh-from-upstream) section is the playbook.

---

## Upstream

| Field | Value |
|---|---|
| Project | Bulwark Webmail (modern JMAP webmail client for Stalwart, Next.js) |
| Upstream repo | https://github.com/bulwarkmail/webmail |
| Upstream default branch | `main` |
| Currently integrated upstream version | **1.6.0** (released 2026-05-01 by upstream) — current built tag `v1.6.0-mine.7` |
| License | [AGPL-3.0-only](https://github.com/bulwarkmail/webmail/blob/main/LICENSE). The push-mirror to `github.com/binaryBeachLLC/bb-bulwark-fork` (public) plus the public Forgejo repo at `git.binarybeach.io/binarybeach/bb-bulwark-fork` together satisfy AGPL §13's source-disclosure obligation for network use. |

`git log main..upstream` = upstream changes I haven't pulled in
`git log upstream..main` = binarybeachio's customizations (today: just `BINARYBEACHIO.md` + `.gitattributes`)

## What's customized

Eight files. Total: ~90 lines.

| File | Change | Lines | Conflict risk on upgrade |
|------|--------|-------|--------------------------|
| `.gitattributes` | Pin `*.sh`, `*.j2`, `Dockerfile*` to LF eol so Windows clones don't crashloop the container | ~10 | None — upstream has no `.gitattributes` of its own |
| `BINARYBEACHIO.md` | This file | ~80 | None — net-new file |
| `app/api/auth/sso/start/route.ts` | (1) Forward optional `OAUTH_AUTH_PROMPT` env into the OIDC authorize URL as the standard `prompt` parameter. Lets the deployment force Zitadel's account picker (`prompt=select_account`) even when a session exists, which is the only way Bulwark's "+ Add Account" flow can switch identities against an IdP the browser is already signed into. Upstream omits the parameter entirely. Note: this server-side route only fires in `OAUTH_ONLY=true && AUTO_SSO_ENABLED=true` mode. The interactive sign-in path (login form's "Sign in with SSO" button + "+ Add Account") is patched separately on the client side — see the four entries below. (2) Fix the `requestOrigin` computation to trust `X-Forwarded-Host` / `X-Forwarded-Proto` as fallback when the browser doesn't send an `Origin` header. Upstream falls back to `request.nextUrl.origin`, which behind a reverse proxy resolves to the container's HOSTNAME:PORT bind (e.g. `https://0.0.0.0:3000`) and rejects every Origin-less request, triggering Bulwark's "session expired" loop. | ~15 | Low — both changes sit at the top of the URL builder. |
| `lib/admin/types.ts` | (a) Add `oauthAuthPrompt` (env `OAUTH_AUTH_PROMPT`) to `CONFIG_ENV_MAP`. (b) mine.7: add `disableAddAccount` (env `DISABLE_ADD_ACCOUNT`) to the same map. | ~3 | Low — record-literal entries. |
| `app/api/config/route.ts` | Expose `oauthAuthPrompt` + `disableAddAccount` on the `/api/config` JSON the browser fetches at boot. Required for client-side hooks to read the env. | ~2 | Low — two new fields. |
| `hooks/use-config.ts` | Add `oauthAuthPrompt: string` and `disableAddAccount: boolean` to `ConfigData` and to the three `setConfig({...})` initializers in `useConfig()`. | ~8 | Low — boilerplate. |
| `components/layout/account-switcher.tsx` | mine.7: read `disableAddAccount` from `useConfig()` and gate the "+ Add Account" button render block on `!disableAddAccount`. | ~3 | Low — one conditional, additive. |
| `app/[locale]/login/page.tsx` | (1) In `handleOAuthLogin`, append `prompt=<oauthAuthPrompt>` to the authorize URL. (2) Persist `oauth_cookie_slot = useAccountStore.getState().getNextCookieSlot()` to sessionStorage before redirecting to the IdP, so the auth callback writes the refresh token to the correct per-account `jmap_rt_<slot>` cookie. Upstream reads the key but never writes it, collapsing every account onto slot 0. | ~12 | Low — additive at the start of `handleOAuthLogin`. |
| `stores/auth-store.ts` | (1) In `loginWithOAuth`, distinguish "sessionStorage has no `oauth_cookie_slot`" from "value is 0" so the fallback to `getNextCookieSlot()` actually fires. Upstream's `parseInt(getItem(...) \|\| '0')` collapsed both cases. (2) In `loginWithServerSso`, pass `slot: getNextCookieSlot()` in the POST body to `/api/auth/sso/complete` so the server-side SSO path also writes per-account cookies. | ~15 | Low — both edits are localized to the OAuth slot-allocation lines. |
| `app/api/auth/sso/complete/route.ts` | Read `slot` from request body (default 0 for back-compat) and use `refreshTokenCookieName(slot)` instead of the hardcoded `refreshTokenCookieName(0)`. Mirrors the existing pattern in `/api/auth/token/route.ts` POST. Pairs with the auth-store change so the slot threads through end-to-end on the server-side SSO path. | ~5 | Low — same shape as the parallel route already handling slots. |

## Why we forked despite no patches

This was a deliberate choice. Vanilla Path A (pulling `ghcr.io/bulwarkmail/webmail:1.6.0` directly) would work end-to-end today. Path B was chosen because:

- **The cost of standing up the pipeline ahead of needing it is small** (~1 hour total: Forgejo + GitHub repo provisioning via `new-bb-fork.py`, local clone, `.gitattributes` + this doc, image build, push).
- **The cost of rushing the pipeline together when we *first* need a patch is much larger** (build infra + repo split decisions made under time pressure, often at 2am during an upstream-blocking issue).
- **For services we self-host on user-facing FQDNs, an off-site source archive is a real value** independent of patches — both for AGPL compliance and as a hedge against upstream disappearing.

## Tag history

| Tag | Status | What changed |
|---|---|---|
| `v1.6.0-mine.1` | superseded | Initial fork tag. No source-level patches; adds `.gitattributes` (LF pin) + `BINARYBEACHIO.md`. Build pipeline established. |
| `v1.6.0-mine.2` | superseded | First functional patch: `OAUTH_AUTH_PROMPT` env forwarded into the OIDC `prompt` param via the **server-side** SSO start route (`app/api/auth/sso/start/route.ts`). Discovered post-deploy that this route only fires in `OAUTH_ONLY=true && AUTO_SSO_ENABLED=true` auto-redirect mode, so the env was inert for our deployment (which runs `OAUTH_ONLY=false` to keep the local-password break-glass surface). |
| `v1.6.0-mine.3` | superseded | Extends `OAUTH_AUTH_PROMPT` to the **client-side** authorize-URL builder (`handleOAuthLogin` in `app/[locale]/login/page.tsx`) — the path actually used by the login-form "Sign in with SSO" button and the "+ Add Account" flow. Plumbing: env → `CONFIG_ENV_MAP` → `/api/config` JSON → `useConfig()` → `handleOAuthLogin`. Sister patch to mine.2's server-side change; both stay in tree because both code paths exist in upstream. |
| `v1.6.0-mine.4` | superseded | Fix `/api/auth/sso/start` origin validation behind a reverse proxy. Upstream computes `requestOrigin` as `request.headers.get('origin') ?? request.nextUrl.origin`. The fallback resolves to the container's HOSTNAME:PORT bind (e.g. `https://0.0.0.0:3000`), so any request that omits the Origin header (service-worker retries, etc.) gets a 400 "Invalid redirect_uri", which Bulwark's auth-store interprets as "session expired" and forces a re-login loop. Patch trusts `X-Forwarded-Host` + `X-Forwarded-Proto` as fallback when Origin header is absent. Symptom this fixes: ~60s session expiry / forced re-login loop on Bulwark behind Traefik. |
| `v1.6.0-mine.5` | superseded | Add `offline_access` to `DEFAULT_SCOPES` in `lib/oauth/tokens.ts` so the OAuth flow asks Zitadel for a refresh token. Without this scope, Zitadel returns access_token-only; Bulwark never sets the `jmap_rt` cookie (the conditional in `app/api/auth/sso/complete/route.ts` is dead code with no `tokens.refresh_token`); on every page refresh, `refreshAccessToken()` finds no cookie → 401 → forced re-login. **Pairs with a Zitadel-side change**: the Stalwart app's `grantTypes` must also include `OIDC_GRANT_TYPE_REFRESH_TOKEN` — both are required; either alone is a no-op. |
| `v1.6.0-mine.6` | superseded | Fix multi-account cookie-slot allocation. Upstream had a half-implemented feature: `loginWithOAuth` reads `sessionStorage['oauth_cookie_slot']` to pick the refresh-token cookie slot, but `handleOAuthLogin` never wrote that key — so every account collapsed onto slot 0 and overwrote each other's `jmap_rt` cookies. Also `app/api/auth/sso/complete/route.ts` hardcoded `refreshTokenCookieName(0)`, the same bug on the server-side SSO path. **Three coordinated patches**: (1) `app/[locale]/login/page.tsx` `handleOAuthLogin` writes `oauth_cookie_slot = useAccountStore.getState().getNextCookieSlot()` before redirecting to the IdP; (2) `stores/auth-store.ts` `loginWithOAuth` distinguishes "no value set" from "value is 0" and falls back to live `getNextCookieSlot()`; `loginWithServerSso` passes the slot in the POST body to sso/complete; (3) `app/api/auth/sso/complete/route.ts` reads `slot` from the body (default 0 for back-compat), matching the existing pattern in `/api/auth/token/route.ts` POST. Symptom this fixes: "+ Add Account" doesn't survive a refresh, dropdown loses the second account, From dropdown shows the wrong account. **Note:** kept in tree as a back-compat-friendly bug fix even though mine.7 hides the Add Account UI for the binarybeachio deployment — the underlying cookie-slot bug is real upstream behavior and the patch is upstream-able. |
| `v1.6.0-mine.7` | active | Add `DISABLE_ADD_ACCOUNT` env-gated UI suppression. When `DISABLE_ADD_ACCOUNT=true`, the per-Bulwark "+ Add Account" button in `components/layout/account-switcher.tsx` is hidden. **Why**: the binarybeachio deployment puts oauth2-proxy in front of Bulwark with one Zitadel session per browser at `.binarybeach.io`. Adding a second Zitadel identity inside Bulwark fights that single-session model — the secondary account's bearer token authenticates against Stalwart fine, but the *edge* gate validates only the primary identity, so a deactivated primary kills access to all secondary accounts. Multi-identity moves to the platform layer (a "Switch BinaryBeach.io account" affordance that calls `/oauth2/sign_out` then `/oauth2/start?prompt=select_account` — see binarybeachio docs for the bridge `/switch` route). **Plumbing**: env → `CONFIG_ENV_MAP` (`lib/admin/types.ts`) → `/api/config` JSON (`app/api/config/route.ts`) → `useConfig()` hook (`hooks/use-config.ts`) → `account-switcher.tsx` consumer. Four files, ~12 lines net. Inert when env unset (defaults to `false` = upstream behavior). Direct nav to `/login?mode=add-account` is *not* blocked — operator-side workaround if it's ever needed; the dropdown is the only normal-path entry. |

## Refresh from upstream

When a new upstream version is released (`1.6.1`, `1.7.0`, etc.):

```sh
cd C:\Users\maxwe\GitHubRepos\bb-bulwark-fork

# Pull the latest from upstream
git fetch upstream --tags
git checkout upstream
git merge --ff-only upstream/main
git push origin upstream

# Bump main to the new upstream tag (e.g. 1.6.1) and re-apply our patches
git checkout main
git rebase --onto 1.6.1 1.6.0   # if there are local commits beyond docs
# OR, if patches are zero (today):
git checkout main
git reset --hard 1.6.1
# then re-apply .gitattributes + BINARYBEACHIO.md commit on top

# Tag and push
git tag v1.6.1-mine.1
git push origin main --force-with-lease
git push origin v1.6.1-mine.1

# Rebuild and push image
docker build \
  -t git.binarybeach.io/binarybeach/bb-bulwark-fork:v1.6.1-mine.1 \
  -t git.binarybeach.io/binarybeach/bb-bulwark-fork:latest .
docker push git.binarybeach.io/binarybeach/bb-bulwark-fork:v1.6.1-mine.1
docker push git.binarybeach.io/binarybeach/bb-bulwark-fork:latest
```

Then bump `BULWARK_IMAGE` in `infrastructure/bulwark/.env` and re-run the binarybeachio bootstrap.

## Build & push

```sh
cd C:\Users\maxwe\GitHubRepos\bb-bulwark-fork

docker build \
  -t git.binarybeach.io/binarybeach/bb-bulwark-fork:v1.6.0-mine.1 \
  -t git.binarybeach.io/binarybeach/bb-bulwark-fork:latest .

docker push git.binarybeach.io/binarybeach/bb-bulwark-fork:v1.6.0-mine.1
docker push git.binarybeach.io/binarybeach/bb-bulwark-fork:latest
```

Upstream's `Dockerfile` is a standard two-stage Next.js build (`node:24-alpine` builder → runner with `node server.js` as the entrypoint). No build args required for our use case; `NEXT_PUBLIC_BASE_PATH` defaults to empty (root path) and `GIT_COMMIT=unknown` is fine.
