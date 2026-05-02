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

Two files. Total: ~50 lines of text — zero source-level patches.

| File | Change | Lines | Conflict risk on upgrade |
|------|--------|-------|--------------------------|
| `.gitattributes` | Pin `*.sh`, `*.j2`, `Dockerfile*` to LF eol so Windows clones don't crashloop the container | ~10 | None — upstream has no `.gitattributes` of its own |
| `BINARYBEACHIO.md` | This file | ~70 | None — net-new file |

If/when patches land on top of v1.6.0, list them here with the same shape as `bb-vaultwarden-fork/BINARYBEACHIO.md`'s `## What's customized` table.

## Why we forked despite no patches

This was a deliberate choice. Vanilla Path A (pulling `ghcr.io/bulwarkmail/webmail:1.6.0` directly) would work end-to-end today. Path B was chosen because:

- **The cost of standing up the pipeline ahead of needing it is small** (~1 hour total: Forgejo + GitHub repo provisioning via `new-bb-fork.py`, local clone, `.gitattributes` + this doc, image build, push).
- **The cost of rushing the pipeline together when we *first* need a patch is much larger** (build infra + repo split decisions made under time pressure, often at 2am during an upstream-blocking issue).
- **For services we self-host on user-facing FQDNs, an off-site source archive is a real value** independent of patches — both for AGPL compliance and as a hedge against upstream disappearing.

## Tag history

| Tag | Status | What changed |
|---|---|---|
| `v1.6.0-mine.1` | active | Initial fork tag. No source-level patches; adds `.gitattributes` (LF pin) + `BINARYBEACHIO.md`. Build pipeline established. |

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
