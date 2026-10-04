# triptrack

Plan a trip, live it and log it in one place — day-by-day itineraries, bookings
and group expense settlement. Runs on a single-node k3s homelab, delivered
continuously by Argo CD.

## Roadmap

Built lean, one deployable step at a time. The delivery pipeline lands with the
skeleton in step 1, so every feature after it goes out through a mechanism already
watched working.

- [x] **1 — GitOps and walking skeleton.** Health, readiness and liveness endpoints
      and a minimal SPA shell showing the build version, plus the whole delivery
      pipeline: Helm chart, Argo CD Application, image build that pins its own tag,
      graceful shutdown and the rollout strategy. **This one deploys.** Proven by
      pushing a commit and reading the SHA back off `/health`.
- [x] **2 — Postgres, migrations and accounts.** Brings in the datastore, Drizzle
      migrations, and local accounts with signed session cookies. First step with
      required environment variables.
- [x] **3 — Trips, participants and invite links.** The root aggregate, owned by an
      account. Participants with a nullable user link, and signed invite links with
      expiry and revocation.
- [ ] **4 — Itinerary.** Trip locations, days keyed by `day_number` with bulk date
      shift, entries with the `planned → done | skipped | cancelled` lifecycle and
      `replaced_by`, and materialised per-entry attendance.
- [ ] **5 — Bookings.** Lodging, transit and event bookings as one registry.
      Per-night lodging selection on a day, and many-to-many transit and event links.
- [ ] **6 — Expenses.** Per-day, per-booking and per-entry costs with shares, the
      payer-holds-remainder rule, private spend, and totals grouped by currency.
- [ ] **7 — Settlement.** Derived per-participant balances, a simplified settlement
      plan, recorded settlements, and the lock that makes expenses immutable once
      settled. Kept behind its own module boundary — this is the scope risk.
- [ ] **8 — Photos.** Resolves the deferred storage decision (Garage versus a PVC),
      then upload and attachment to days and entries.

Each step is independently deployable and reviewable. Steps 2 onward are ordered so
every dependency already exists: attendance needs participants, expenses need days and
bookings, settlement needs expenses.

## Endpoints

| Method | Path            |
| ------ | --------------- |
| GET    | `/health`       |
| GET    | `/health/live`  |
| GET    | `/health/ready` |

## Local development

```bash
npm run dev
curl localhost:8080/health
```

## Testing

```bash
node --test
```

## Deployment

Push to `main`. CI builds an immutable `sha-` tagged image and commits that tag into
the chart; Argo CD syncs it and Kubernetes rolls it out behind readiness probes.
Nothing is deployed by hand.

`/health` reports the build it was compiled from, so a deploy is observable:

```bash
curl -s https://triptrack.nandan-hl.dev/health
# {"status":"ok","version":"sha-a1b2c3d"}
```

Bootstrap and rollback are in [`DEPLOY.md`](./DEPLOY.md). Conventions live in
[`CLAUDE.md`](./CLAUDE.md); architecture in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
