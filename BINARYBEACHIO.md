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
| Currently integrated upstream version | **1.6.0** (released 2026-05-01 by upstream) — current built tag `v1.6.0-mine.1` |
| License | [AGPL-3.0-only](https://github.com/bulwarkmail/webmail/blob/main/LICENSE). The push-mirror to `github.com/binaryBeachLLC/bb-bulwark-fork` (public) plus the public Forgejo repo at `git.binarybeach.io/binarybeach/bb-bulwark-fork` together satisfy AGPL §13's source-disclosure obligation for network use. |

`git log main..upstream` = upstream changes I haven't pulled in
`git log upstream..main` = binarybeachio's customizations (today: just `BINARYBEACHIO.md` + `.gitattributes`)

## What's customized

Seven files. Total: ~80 lines.

| File | Change | Lines | Conflict risk on upgrade |
|------|--------|-------|--------------------------|
| `.gitattributes` | Pin `*.sh`, `*.j2`, `Dockerfile*` to LF eol so Windows clones don't crashloop the container | ~10 | None — upstream has no `.gitattributes` of its own |
| `BINARYBEACHIO.md` | This file | ~80 | None — net-new file |
| `app/api/auth/sso/start/route.ts` | (1) Forward optional `OAUTH_AUTH_PROMPT` env into the OIDC authorize URL as the standard `prompt` parameter. Lets the deployment force Zitadel's account picker (`prompt=select_account`) even when a session exists, which is the only way Bulwark's "+ Add Account" flow can switch identities against an IdP the browser is already signed into. Upstream omits the parameter entirely. Note: this server-side route only fires in `OAUTH_ONLY=true && AUTO_SSO_ENABLED=true` mode. The interactive sign-in path (login form's "Sign in with SSO" button + "+ Add Account") is patched separately on the client side — see the four entries below. (2) Fix the `requestOrigin` computation to trust `X-Forwarded-Host` / `X-Forwarded-Proto` as fallback when the browser doesn't send an `Origin` header. Upstream falls back to `request.nextUrl.origin`, which behind a reverse proxy resolves to the container's HOSTNAME:PORT bind (e.g. `https://0.0.0.0:3000`) and rejects every Origin-less request, triggering Bulwark's "session expired" loop. | ~15 | Low — both changes sit at the top of the URL builder. |
| `lib/admin/types.ts` | Add `oauthAuthPrompt` (env `OAUTH_AUTH_PROMPT`) to `CONFIG_ENV_MAP` so the env is recognized by the admin config layer and admin-dashboard overrides work. | ~1 | Low — one new line in a record literal. |
| `app/api/config/route.ts` | Expose `oauthAuthPrompt` on the `/api/config` JSON the browser fetches at boot. Required for the client-side login flow to know about the env. | ~1 | Low — one new field. |
| `hooks/use-config.ts` | Add `oauthAuthPrompt: string` to the `ConfigData` type and the three `setConfig({...})` initializers in `useConfig()`. | ~5 | Low — boilerplate next to existing OIDC fields. |
| `app/[locale]/login/page.tsx` | In `handleOAuthLogin` (the client-side authorize-URL builder used by the "Sign in with SSO" button on the login form **and** the "+ Add Account" flow), append `prompt=<oauthAuthPrompt>` if the env is set. Sister patch to `app/api/auth/sso/start/route.ts` — that one covers `OAUTH_ONLY` auto-redirect; this one covers interactive sign-in. | ~10 | Low — sits in the URL builder right before `window.location.href`. |

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
| `v1.6.0-mine.4` | active | Fix `/api/auth/sso/start` origin validation behind a reverse proxy. Upstream computes `requestOrigin` as `request.headers.get('origin') ?? request.nextUrl.origin`. The fallback resolves to the container's HOSTNAME:PORT bind (e.g. `https://0.0.0.0:3000`), so any request that omits the Origin header (service-worker retries, etc.) gets a 400 "Invalid redirect_uri", which Bulwark's auth-store interprets as "session expired" and forces a re-login loop. Patch trusts `X-Forwarded-Host` + `X-Forwarded-Proto` as fallback when Origin header is absent. Symptom this fixes: ~60s session expiry / forced re-login loop on Bulwark behind Traefik. |

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
