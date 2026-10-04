# ADR-0002 — Build the delivery pipeline before any feature

**Status:** Accepted · 2026-10-04

## Context
The tempting order is to build something worth deploying and then work out how to
deploy it. That defers every infrastructure unknown to the moment there is also
application risk in play, and the two failures become hard to tell apart.

## Decision
Step 1 is the walking skeleton **and** the entire pipeline, in one step — health,
readiness and liveness probes, Helm chart, Argo CD Application, image build, tag
write-back, graceful shutdown and the rollout strategy — proven by pushing a commit and
reading the build SHA back off `/health`. **The first pull request deploys.** Features
start at step 2.

Amended 2026-10-04: originally split across two steps. Merged so that the first merge
produces a deployed URL rather than the second.

## Consequences
- The first deploy is the boring one. Every later step lands through a mechanism
  already watched working, so a failure after step 2 is an application failure.
- `/health` must report the build it was compiled from, injected at build time.
  Without it, "the pipeline worked" is an inference from a green check.
- Configuration should have no required variables early on, so each step stays
  independently deployable and a half-finished feature cannot stop the pod booting.
  This becomes less important once the shape is settled.
- **The first pull request is large** — server, probes, Dockerfile, chart, workflow and
  Argo CD Application together — and so it is the hardest of the project to review.
  That is the deliberate price of deploying from the first merge.
- There is a tension with this ADR's own reasoning: bundling the skeleton with the
  pipeline puts application and infrastructure risk in one change, which is what the
  split was meant to avoid. It costs little in practice **because the skeleton carries
  almost no logic** — a failed first deploy is still almost certainly infrastructure.
  That stops being true if anything non-trivial creeps into step 1.
- This step is the least satisfying work in the project and produces almost nothing
  visible. That is the cost, and it is paid once.
