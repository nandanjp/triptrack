# ADR-0004 — Store data in Postgres in-cluster, rather than SQLite

**Status:** Accepted · 2026-10-04

## Context
The data is small. A three-week itinerary with entries, bookings and expenses is
kilobytes; the only large objects are photos, which are not going in the database. Total
user count is a handful of people per trip. On volume alone, SQLite on a PVC would be
comfortably adequate for the lifetime of this application, and it was seriously
considered — a single-file backup is a genuine operational advantage over a database to
operate.

What argued against it was not scale but the queries. The model's value is in derived
views: per-participant balances from expense shares, day allocation grouped by location,
cross-trip place and country history. These are the aggregates the application exists
to compute, and they will be iterated on. Drizzle keeps them close to SQL rather than
hiding them behind an object graph, which suits queries that will be tuned by hand.

## Decision
Postgres, running in-cluster, on the k3s default `local-path` StorageClass. Drizzle for
queries and migrations. No managed or external database.

## Consequences
- **This is the one piece of data with no copy anywhere else.** Photos have originals on
  a phone; itineraries and settlement history do not. `local-path` is node-local and
  unreplicated, so **a backup job is a requirement rather than an improvement, and until
  it exists the risk is live.** Recorded as the top accepted risk in
  `docs/ARCHITECTURE.md`.
- **`fsGroup` must equal `runAsUser` on the Postgres pod.** A PVC mounts root-owned, so
  a non-root container cannot write to it, and the failure surfaces from Postgres as a
  permission error that reads like a database bug.
- **The application now has a required environment variable.** That erodes ADR-0002's
  property that the service boots with no configuration, from step 3 onward. The
  mitigation is that health endpoints must answer while the database is unreachable, so
  a database outage does not present as a dead pod and get restarted pointlessly.
- **Readiness must not probe Postgres.** At one replica, failing readiness on a database
  blip removes the only pod from rotation and escalates a degraded feature into a full
  outage.
- **Migrations must survive a rollout.** With `maxUnavailable: 0` and `maxSurge: 1` an
  old and a new pod overlap, so every schema change is expand-then-contract across two
  deploys. A rename done in one migration breaks the pod still serving traffic.
- Postgres on a single node means the database is down whenever the node is, and a
  restore is a manual exercise. Accepted while the data is young.
- Choosing a server over SQLite forecloses the trivially-copyable-backup property, which
  is the thing that would have made the first point much easier to solve.
- **Drizzle's mapping of Postgres `numeric` must be verified, not assumed.** Money is
  stored as integer minor units (`DOMAIN.md` D11), so the exposure is limited — but a
  driver handing back a float for a numeric column would undermine that decision
  quietly. See ADR-0003.
