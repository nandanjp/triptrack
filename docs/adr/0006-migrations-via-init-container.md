# ADR-0006 — Apply migrations from an init container, not from the application process

**Status:** Accepted · 2026-10-04

## Context
ADR-0003 deferred this to step 2, which is when the first migration exists. Four options
were real:

- **In-process on startup.** Simplest, and no extra manifest. But it couples a migration
  failure to application boot in a way that is hard to read in logs, and it puts schema
  authority inside a process whose job is serving traffic.
- **An Argo CD `PreSync` hook Job.** The most correct: migrations finish before any new
  pod rolls, and a failure fails the sync cleanly. Costs a second manifest and makes the
  repo depend on Argo-specific hook semantics.
- **A hand-run job.** Rejected outright — it makes deploys manual, which is what
  ADR-0001 exists to avoid.
- **An init container**, running a separate bundled entrypoint before the application
  container starts.

## Decision
An **init container** on the Deployment, running `dist/migrate.js` — a second esbuild
entrypoint built from `src/db/migrate.ts` — with only `DATABASE_URL` in its environment.

Kubernetes runs it to completion before the application container starts, so the
application never serves against a schema it has not migrated to.

## Consequences
- **Every migration must be backward compatible for the length of a rollout.** With
  `maxUnavailable: 0` and `maxSurge: 1`, the old pod keeps serving while the new pod's
  init container migrates, so old code runs against the new schema for that window.
  Expand, deploy, then contract — a rename or a drop done in one migration breaks the
  pod still taking traffic. This is the single most likely way to cause an outage here,
  and it is **not** a consequence of this choice: a `PreSync` hook has the same property.
- **A failed migration crash-loops the pod** rather than failing the sync up front.
  `progressDeadlineSeconds` eventually marks the rollout Degraded and Argo CD surfaces
  that, but it is slower and noisier to diagnose than the `PreSync` hook would have
  been. That is the price of not encoding Argo-specific semantics in the repo, and it is
  the thing most likely to make this decision look wrong later.
- **The init container runs on every pod start**, including restarts and node drains, not
  only on deploys. Harmless because Drizzle's journal makes application idempotent, but
  it means a database outage also blocks a plain pod restart.
- **The migrator retries its first connection**, ten attempts with exponential backoff
  capped at 5s — about 32 seconds in total. On a cold cluster the Postgres StatefulSet
  and this Deployment start together, so early attempts find nothing listening.
  Kubernetes would retry the whole init container anyway, but that presents as a
  crash-loop in `kubectl get pods` and buries the real error when there is one.
- **A readiness probe on Postgres is not sufficient to order this**, which was found by
  verification rather than reasoning: the official postgres image answers `pg_isready`
  on its unix socket while initdb's *temporary* server is still running — before the real
  TCP listener and the application role exist. A migration that trusted the probe would
  fail against a database that had just reported itself ready. The retry above is what
  actually closes that window.
- **Concurrency is safe only because `replicaCount` is 1.** At more than one replica, two
  new pods could migrate simultaneously and Drizzle's migrator would need an advisory
  lock. Raising the replica count without addressing that would be a real bug.
- **Migration SQL cannot be bundled**, since it is read from disk at runtime, so the
  image carries `drizzle/` alongside the two JavaScript bundles. The Dockerfile copies it
  explicitly, and `.dockerignore` must never exclude it.
- `DATABASE_URL` is now referenced twice in the Deployment, once per container. Mild
  duplication, accepted over a shared `envFrom` that would also hand the init container
  the session secret it has no business holding.
