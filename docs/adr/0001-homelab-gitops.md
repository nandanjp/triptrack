# ADR-0001 — Deploy on the homelab via Argo CD

**Status:** Accepted · 2026-10-04

## Context
The application needs somewhere to run and a way to get there. A managed platform
would be less work, but the homelab already runs k3s with Argo CD, Traefik and a
Cloudflare Tunnel, and the goal includes operating the infrastructure rather than
renting it.

## Decision
Single-node k3s on `homelab`. A Helm chart in this repository, reconciled by the
Argo CD instance that `../dramadive` installs. Images on Docker Hub under
`nandanjp/`, tagged with the git SHA. CI writes the tag into the chart, and that
commit is what Argo CD syncs.

## Consequences
- The image tag commit is the deploy trigger. A code change with no manifest diff
  would otherwise leave Argo CD nothing to sync, so the write-back is required, not
  a convenience. `git log` on the chart values becomes the deploy history.
- Argo CD is shared. This repo contributes only its own `Application`; anything
  touching `argocd-cm` breaks other applications on the cluster silently.
- One node means no real high availability. `maxUnavailable: 0` with `maxSurge: 1`
  gives a clean rollout but not fault tolerance — if the node is down, so is this.
- Hostnames are effectively cluster-global and the Cloudflare wildcard matches one
  label, which constrains naming more than it first appears.
- The dev machine is arm64 and the node is amd64, so every image build must pin
  `linux/amd64` or it fails at pull time rather than build time.
