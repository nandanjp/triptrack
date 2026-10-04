# ADR-0003 — Build the service on Node with Hono and Drizzle, shipping the SPA in the same deployable

**Status:** Accepted · 2026-10-04

## Context
The domain was settled before the stack (see `docs/DOMAIN.md`), so the choice was made
against known requirements: a relational model with fourteen entities, derived aggregate
queries for balances and allocations, and one subdomain — expense settlement — whose
invariants are the real risk in the project. A React frontend is non-negotiable, since
this is used from a phone mid-trip, so the architectural question was two deployables or
one. One won, which makes the API/SPA boundary internal and lets both halves share
types directly.

Learning value was an explicit goal rather than a tiebreaker. Four alternatives were
seriously considered:

- **.NET with ASP.NET Core and EF Core.** The strongest technical argument of any
  candidate: runtime type enforcement on the settlement invariants, for free. Rejected
  because it needs hand-written TypeScript types or OpenAPI codegen for the SPA — a tax
  paid on every roadmap step — and because it puts two toolchains and two caches in CI.
  Parked for a future application rather than discarded.
- **Bun** as the runtime, with the same Hono and Drizzle on top. Rejected on maturity:
  it would have been the least proven dependency in the system, sitting underneath
  everything, on a pipeline whose whole purpose (ADR-0002) is to be boringly reliable.
  The learning value of this stack is in Hono and Drizzle, not the runtime, so Bun was
  carrying the risk without carrying the benefit.
- **Rust with Axum and sqlx** was the best fit on the merits — invariants made
  unrepresentable rather than merely tested — but too costly to iterate on work that is
  mostly CRUD.
- **Elixir with Phoenix** offered the largest paradigm shift, but its standout strength
  is real-time collaborative editing, which `DOMAIN.md` explicitly defers out of v1, and
  LiveView would displace the SPA rather than coexist with it.

## Decision
TypeScript on **Node 24**, with **Hono** for HTTP via `@hono/node-server`, and
**Drizzle** for queries and migrations against Postgres.

The React and Vite frontend is built in CI and served as static assets by the same Hono
process, so **one artifact contains both halves and they cannot version-skew.** Both
sides import the same TypeScript types — no codegen, no generated client.

Development runs `.ts` directly on Node's built-in type stripping; production bundles
with esbuild. Tests use the built-in `node --test`. No `tsx`, no `ts-node`, no Jest, no
Vitest.

Validation at every boundary is explicit, with a schema validator (zod or valibot).
This is not ceremony: TypeScript's guarantees vanish at runtime, and the settlement
invariants are what the validator exists to protect.

The build SHA is injected at bundle time via esbuild `--define` and reported on
`/health`, satisfying ADR-0002's acceptance test.

Listens on **8080** — our convention, inherited from the chart rather than a runtime
default.

## Consequences
- **The domain's enums cannot be TypeScript `enum`s.** Verified on Node 24.21.0: `enum`
  fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, because type stripping handles only
  erasable syntax. `DOMAIN.md` leans on enums heavily — `Booking.kind`,
  `DayEntry.status`, `split_mode`, `Trip.status`, roles — so all of them are union types
  or `const` objects. A real constraint on how the model is expressed, traded for having
  no build step in development.
- **Decorators are unavailable** for the same reason. Harmless here, because Drizzle
  does not use them, but it forecloses any decorator-based library later.
- **TypeScript types are erased at runtime**, so a malformed row from the database flows
  straight through typed code. The validator layer is recurring work on every endpoint,
  and strictly more work than .NET would have been. It is the accepted cost of one
  language across the stack.
- **Money arithmetic needs deliberate care.** JavaScript has no decimal type.
  `DOMAIN.md` D11 already defends against this with integer minor units, exact to 2^53
  — but equal-splitting divides, and Drizzle's mapping of Postgres `numeric` must be
  checked rather than assumed.
- **Graceful shutdown is hand-rolled.** `@hono/node-server` wraps `node:http`, so
  failing readiness, waiting out EndpointSlice propagation, then `server.close()` with
  `closeIdleConnections()` and a bounded wait is application code. ADR-0002's pipeline
  work asserts that `drainDelay + shutdownTimeout < terminationGracePeriodSeconds` in a
  test so the code and the chart cannot drift.
- **No single-file binary.** The artifact is bundled JavaScript on a Node base image.
  A distroless Node image is non-root and has no shell, so a `preStop` `exec: sleep`
  hook is unavailable — consistent with draining in-process.
- **One language collapses CI to a single toolchain and one cache.**
- **Node is the most battle-tested option on the table.** Choosing it removes the
  largest stack risk the project briefly carried, and the novelty that justified the
  choice now sits in Hono and Drizzle, where it is useful rather than load-bearing.
- **`@hono/node-server` is an adapter on the hot path** that a Bun or Workers deployment
  would not need. Small, maintained, but a dependency between the framework and the
  runtime nonetheless.
- Because **Hono is runtime-agnostic**, moving to Bun or Workers later costs a base
  image and a CI line rather than a rewrite. The hedge that justified Hono still
  applies, now pointing the other way.
- **To confirm at step 1:** the exact esbuild `--define` wiring for the SHA, and whether
  the distroless Node image or `node:24-alpine` gives the better size-to-debuggability
  trade. Neither has been checked.
- **A read-only root filesystem still wants an `emptyDir` at `/tmp`**, kept as a
  precaution rather than a known requirement.
- **One deployable means the SPA cannot ship without the API.** A frontend-only change
  rebuilds everything. At this scale that is a feature — it removes version skew between
  the halves entirely.
- **Who applies migrations is still open.** `drizzle-kit migrate` on startup is simplest
  and races at `maxSurge: 1`; a separate job is correct and adds moving parts. Decided at
  step 3, and it needs its own ADR when it is.
