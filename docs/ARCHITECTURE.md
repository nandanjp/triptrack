# Architecture

The north star. What this is, what it is made of, and where the boundaries are.
Kept current — a stale architecture doc is worse than none.

The domain model and the reasoning behind it live in [`DOMAIN.md`](./DOMAIN.md), which
is the authority on entities, invariants and what is deferred. This file covers shape,
boundaries and operational reality, and does not restate it.

## What it is

A trip is planned, lived and logged in one artifact. Most tools make the itinerary and
the trip report two separate things; here a single `Trip` carries both tenses, and a
spontaneous detour is simply an entry created in the `done` state rather than a
different kind of record.

Consumed by a small group of people — the trip's participants — over the web, from a
phone during a trip and a laptop while planning one. There is no second system
consuming this, and no public API.

The gap it closes: all of this is expressible in Notion, except **aggregating per-day,
per-person costs into a trip total and a settlement**. That aggregation is the reason
the application exists rather than being a template.

## Shape

One deployable. One image, one pod, one hostname.

```
browser
  └── Traefik (Cloudflare Tunnel, triptrack.nandan-hl.dev)
        └── TripTrack  ── Hono on Node, :8080
              ├── /api/auth/*  register · login · logout · me
              ├── /api/trips/* trips · participants · invite issuing
              │                areas · days · date shift · entries · attendance
              │                bookings · per-night lodging · per-day travel
              │                expenses · shares · totals by currency
              │                balances · settlement plan · recorded payments
              ├── /api/invites/*  preview (public) · accept · revoke
              ├── /api/*       404 as JSON, never the SPA
              ├── /*           React SPA, served as static assets
              └── /health*     startup · readiness · liveness

  init container (same image, `dist/migrate.js`) runs Drizzle migrations to
  completion before the application container starts — see ADR-0006
        └── Postgres (in-cluster StatefulSet, local-path PVC, uid 70)
```

The React bundle is built in CI and served by the same Hono process, so the SPA and the
API ship as one artifact and cannot version-skew against each other. Both sides import
the same TypeScript types directly — no codegen, no generated client. There is no
separate frontend deployment.

## Boundaries

**Owns:** trips, participants, locations, days, entries, bookings, photos metadata,
expenses, shares and settlements. Authentication and trip-level authorisation.

**Deliberately outside:**

- **A POI database.** `Place` holds a name, optional coordinates and an optional
  external reference. It is not a gazetteer to maintain, and enriching it from a
  mapping provider stays out until a feature genuinely needs it.
- **Expense settlement as a general ledger.** It settles trips. It is not an
  accounting system, has no double-entry, and does not reconcile against bank data.
- **Photo editing or transcoding.** Bytes in, bytes out. Thumbnailing is the one thing
  that might be absorbed later, and only when the photo step proves it is needed.
- **Real-time collaboration.** Deferred in `DOMAIN.md`; last-write-wins until it is not
  acceptable, which it may never stop being at this scale.
- **Argo CD configuration.** Shared and owned by `../dramadive`. This repo contributes
  exactly one cluster object: its own `Application`.

The tempting absorption is **settlement**. It is the subdomain that can swallow the
project, so it lives behind its own module boundary with balances computed from shares
rather than stored, and it is the last feature step rather than an early one.

## Data

**Postgres, in-cluster, on a `local-path` PVC.** This is the durability obligation in
the system: unlike photos, whose originals stay on a phone, the itineraries and
settlement history have no copy anywhere else, and `local-path` is node-local and
unreplicated. **A backup job is required, not optional, and until it exists this is
outstanding debt** — recorded below as an accepted risk, not a solved problem.

Migrations are Drizzle migrations, applied by an init container (ADR-0006). Because the
rollout runs `maxUnavailable: 0` with
`maxSurge: 1`, an old and a new pod overlap briefly, so a migration must be
backward-compatible for the length of a rollout — expand, deploy, contract. A migration
that drops or renames a column in one step breaks the pod still serving traffic.

**Session cookies are signed with a secret from a Kubernetes Secret**, so nothing
security-relevant is kept on the pod filesystem and the application pod stays
volume-free. Two consequences follow from the homelab reference: env-injected secrets
are read once at process start, so rotating the signing secret requires a
`kubectl rollout restart` rather than taking effect on its own; and rotating it
invalidates every live session. See ADR-0005.

**Money is integer minor units with a currency code (D11).** The exponent belongs to the
currency — KRW has none, CAD has two — and is a presentation concern, resolved through
`Intl` rather than a table. `src/expenses/money.ts` is imported by both the API and the
SPA, which is the shared-code benefit ADR-0003 claimed, actually used.

**Balances are derived on every read and never stored.** `sum(paid) − sum(owed) + payments
made − payments received`, per participant and per currency. A stored running balance is
how these systems go quietly wrong. The only stored settlement facts are the payments
people actually made; the plan that clears them is computed. See ADR-0009.

**The money arithmetic lives behind a module boundary** — `src/expenses/split.ts` and
`src/expenses/settle.ts`, both pure functions with no database and no HTTP — because this
is the subdomain named below as the one that could swallow the project. Two invariants
carry it, and both are property-tested over thousands of random inputs rather than only
enumerated cases:

- shares sum exactly to their expense total, held structurally by the payer absorbing the
  remainder (D13);
- a settlement plan clears the balances it was built from, in at most `n − 1` payments.

**A settled trip's expenses are read-only** (D14). An owner can reopen it, which is the
escape hatch for a mistake and also a real hole in that immutability — see ADR-0009.

**A booking's dates describe what was paid for, not what was used.** Those legitimately
differ — an apartment booked for a whole trip and slept in for three nights, or a stay
cancelled midway — so days reference bookings **explicitly** rather than by date overlap
(D5), and a cancelled booking stays assignable to the nights it genuinely covered.
Lodging hangs off the day as a single value because it belongs to a *night* (D6); transit
and events are many-to-many because a day can involve a flight and a train.

Bookings carry **no cost column**. Cost is an Expense holding the booking's id, so trip
totals aggregate from one place rather than two. That arrives in step 6.

**Day numbers and dates are moved through non-colliding ranges**, not by deferring their
unique indexes — Postgres checks those per row during an UPDATE, so an overlapping bulk
move fails partway. Day numbers pass through negatives, dates park 100,000 days out, both
inside a transaction. ADR-0007 has the reasoning and the alternatives.

**Only a hash of each invite token is stored**, so a database leak yields no working
invites. The plaintext is returned once, when the link is issued, and is not retrievable
afterwards. Unlike a password this needs no salt or KDF: the token is 256 bits of CSPRNG
output, so there is no guessable input space to slow an attacker down over.

**Disposable:** the pod and its filesystem. `/tmp` is an `emptyDir`.

**Photo bytes have no home yet** — the decision is deliberately deferred to the photo
roadmap step. The analysis, so it is not re-derived:

- *Garage* (self-hosted S3) gives presigned URLs, which keeps multi-hundred-megabyte
  transfers out of the application process, and leaves the app volume-free — which also
  removes the `fsGroup` requirement and that whole class of silent permission failure.
- *A PVC on the app* adds no dependency but puts every byte through the app process and
  reintroduces the volume.
- **Neither buys durability on a single node.** Garage's replication needs more than one
  node, so both land on the same unreplicated disk. The real durability answer for
  photos is that the originals remain on the phone.
- Unverified: Cloudflare's proxied request-body limit (believed 100MB on the free plan)
  would cap bulk multi-file uploads through the tunnel. Measure before designing around
  it.

## Contracts

**None across repositories.** Nothing else consumes this service, and the SPA ships
inside the same image as the API, so the HTTP surface between them is internal — a
renamed field needs no expand-then-contract dance, because both halves deploy as one
artifact. This is a real benefit of the single-deployable choice and is worth not giving
up casually.

The one contract that does exist is between the **database schema and the running
pods** during a rollout, described under Data.

Shared cluster surface, which is a contract with other applications rather than with a
consumer:

- `triptrack.nandan-hl.dev` — hostnames are cluster-global and the Cloudflare wildcard
  matches a single label, so this name is claimed cluster-wide.
- The shared Argo CD instance in `argocd`, owned by `../dramadive`. Applying an
  `argocd-cm` from here breaks other applications silently.

## Accepted risks

- **No database backup yet.** The single largest risk in the system. Data with no copy
  elsewhere on an unreplicated node-local disk. Acceptable only while there is no real
  data in it; it stops being acceptable the moment a trip is logged in earnest.
- **Single node, so no high availability.** `maxUnavailable: 0` buys a clean rollout,
  not fault tolerance. If the node is down, so is this.
- **A required connection string erodes ADR-0002's boots-with-no-configuration
  property.** True from step 3 onward, and the honest trade for a real datastore. Health
  endpoints must still answer while the database is unreachable, so a database outage
  does not read as a dead pod.
- **Readiness reflects only this process**, never Postgres. At one replica, failing
  readiness during a database blip would pull the only pod from rotation and turn a
  degraded feature into a total outage.
- **No offline support and no concurrent-edit merging.** Both deferred in `DOMAIN.md`.
  Offline is the expensive one to add later, since it changes the sync model.
- **Invite links are bearer credentials.** Anyone holding one gains trip access. Expiry
  (14 days), revocation and single use are implemented, and each link is bound to one
  participant seat — but a link pasted into a group chat is still a link anyone in that
  chat can use until it is claimed or revoked. See ADR-0005.
- **There is no audit trail on an expense, and reopening a settled trip leaves no trace.**
  An edit replaces the shares outright, and a settled trip is read-only only while its
  owner leaves it settled. Locking bounds the damage; it does not record history. This is
  the first thing to fix if expense history ever matters.
- **A participant who appears in a recorded payment cannot be removed**, because those
  foreign keys are `restrict`. Correct — half a payment is worse than a refusal — but it
  surfaces as a constraint violation rather than a considered message.
- **Private spend is enforced by every query that reads expenses**, not by a row-level
  policy. Each handler filters on the payer's own seat; a future reader that forgets has
  no backstop.
- **A booking's `kind` is enforced in the application, not by the schema.** Nothing at
  the database level stops a transit booking being written into a day's lodging column;
  the handlers check it, and changing a linked booking's kind is refused. A direct SQL
  write could still produce a day "sleeping" on a flight.
- **`day_number` has no positivity CHECK**, because renumbering routes it through
  negative values inside a transaction (ADR-0007). The range is validated in the
  application instead, so a direct SQL write could leave a nonsensical number behind.
- **Trip visibility is enforced per request, not by a row-level policy.** Every handler
  resolves membership before touching trip data, and answers 404 rather than 403 so
  existence does not leak. It is correct but it is application-level, so a handler that
  forgets the check has no backstop. A future step adding many endpoints should consider
  pushing this into the query layer.
- **There is no way to revoke one stolen session.** Sessions are signed cookies with no
  server-side table, so the only remedy is rotating `SESSION_SECRET`, which signs
  everyone out. A sessions table is an additive change if that stops being acceptable.
- **Postgres runs with a writable root filesystem**, unlike the application container.
  Writing is its job, and mounting an `emptyDir` over each path it needs buys little on
  a single node. It keeps `runAsNonRoot`, uid 70 and all capabilities dropped.
- **No email, therefore no self-service password reset.** See ADR-0005.
- **TypeScript syntax is constrained by Node's type stripping.** Verified: `enum`
  throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, so every status, kind and role in
  `DOMAIN.md` is a union type or `const` object rather than a TypeScript `enum`. The
  trade buys no build step in development. See ADR-0003.
- **Validation is load-bearing, not ceremony.** TypeScript is erased at runtime, so the
  schema validators at each boundary are what actually protect the settlement
  invariants. A skipped validator is a silent correctness hole, not a style lapse.

## Decisions

See [`adr/`](./adr/). Anything argued about goes there rather than being re-litigated
here.

| ADR | Decision |
|---|---|
| 0001 | Deploy on the homelab via Argo CD |
| 0002 | Build the delivery pipeline before any feature |
| 0003 | Node, Hono and Drizzle, with the React SPA in the same deployable |
| 0004 | Postgres in-cluster, rather than SQLite |
| 0005 | Shareable invite links, and no email in the system |
| 0006 | Migrations from an init container, not the application process |
| 0007 | Bulk day moves pass through non-colliding values |
| 0008 | An expense edit that moves money must restate the split |
| 0009 | Derived balances, greedy simplification, lock rather than version |
