# triptrack — working agreement

Plan a trip, live it and log it in one place — day-by-day itineraries, bookings
and group expense settlement. Runs on a single-node k3s homelab, delivered by
Argo CD.

Read `README.md` for the step roadmap and tick steps off there as they land.
Architecture and the decisions behind it are in `docs/ARCHITECTURE.md` and
`docs/adr/`.

## Process — follow without exception

- **Branch names and commit messages are Claude's to choose.** Delegated 2026-10-04 to
  keep momentum — do not propose either and wait for approval.
- **Pushing and opening pull requests needs no permission.** Push the branch, open the PR.
- **The gate is the merge.** After opening a PR, stop and wait for Nandan to merge it and
  confirm. Do not begin the next roadmap step before that confirmation arrives.
- **PRs** — one per step, stacked when changes genuinely depend on each other.
  Don't split a change that can't stand alone, and don't split a small one at all.
- **Merging to `main` deploys.** Argo CD auto-syncs it. All review happens pre-merge.
- **Stacks** use GitHub's native stacked PRs via `gh stack` (`push`, `submit`,
  `rebase`, `merge`). Merging a lower layer auto-retargets the layers above it.

## PR bodies

Concise, in this order:

```
## TLDR
## What Changed
## Testing
## Other considerations
```

`Testing` covers only how to exercise the changes in that PR, not the whole system.
`Other considerations` is for serious negative impacts and genuine gotchas only —
omit the heading entirely when there are none, which is the common case.

`.github/pull_request_template.md` holds this as prompts. It applies to PRs opened
in the UI or with a bare `gh pr create`; passing `--body-file` bypasses it, so the
structure still has to be followed by hand.

## Decisions

A decision worth arguing about gets an ADR in `docs/adr/`, numbered, in the
Context / Decision / Consequences form. Record the consequences that are annoying,
not only the ones that are flattering — they are the reason the file is worth
reading later.

## Leanness

Keep only what the service needs at its current stage. No speculative abstractions,
no dependency that isn't load-bearing, no dead config, manifest or env var. Delete
rather than comment out. When a step removes the last consumer of something, remove
that thing in the same step.

Comments state what a thing is for and the non-obvious why. They never restate the
code.

## Homelab facts

- Single-node k3s on `homelab`, **x86_64**; dev machine is Apple Silicon — always
  build `linux/amd64`.
- Traefik behind a Cloudflare Tunnel wildcard. `*.nandan-hl.dev` matches **one**
  label only, so hostnames must stay single-level. Hostnames are cluster-global
  even though Ingress objects are namespaced — avoid generic names.
- **Argo CD is shared and not owned by this repo.** It is installed and configured
  by `../dramadive`. Never apply an `argocd-cm` or `argocd-cmd-params-cm` from
  here; that drops `helm.valuesFileSchemes` and silently breaks other apps. Argo CD
  changes belong in dramadive.
- Images: Docker Hub `nandanjp/triptrack`, tagged `sha-<short>`. CI pins the tag into
  the chart; that commit is the deploy trigger. Never pin a floating tag.
- Secrets are created out of band with `kubectl create secret`, never committed.
  Adding a key to an existing secret uses `patch`, not `create`.
- TLS terminates at Cloudflare, so `X-Forwarded-Proto` is unreliable. Any absolute
  URL the service generates takes its scheme from configuration.
