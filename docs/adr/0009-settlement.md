# ADR-0009 — Derive balances, simplify greedily, and lock the trip rather than version it

**Status:** Accepted · 2026-10-04

## Context
Settlement is the subdomain `ARCHITECTURE.md` named as the one that could swallow the
project, so the question was how little could be stored while still answering "who owes
whom what" correctly.

Three decisions had real alternatives.

**Where balances live.** A running balance column per participant would make reads
trivial. Rejected: every write would have to update it in the same transaction, and any
path that forgot — a direct SQL fix, a future bulk import — leaves a number that looks
authoritative and is wrong. There is no cheap way to detect that.

**How to simplify.** Minimising the number of payments that clear a set of balances is
NP-hard, so an exact algorithm was never on the table at any size worth having.

**What "settled" means.** `DOMAIN.md` D14 already chose locking over versioning, on the
grounds that the expected flow is settling up at the end of a trip. That left open
whether a trip can be declared settled while someone is still owed.

## Decision
**Balances are derived on every read**: `sum(paid) − sum(owed) + payments made − payments
received`, grouped by participant and currency. The only stored settlement facts are the
payments people actually made.

**Simplification is greedy** — largest debtor to largest creditor, repeatedly. It is not
provably minimal, but it always produces at most `n − 1` payments, which is the property
that matters in practice. Ties break on participant id so the plan is stable: a
settlement that reshuffled between page loads would be unusable.

**Balances are expected to sum to zero**, and when they do not the plan is withheld and
the discrepancy is reported. The input cannot be non-zero by construction — every
expense's shares sum to its total, and a payment moves equal amounts between two
balances — so a non-zero sum means something upstream is broken and silence would be the
wrong answer.

**Each currency settles independently.** A CAD debt cannot be cancelled against a KRW
credit, which follows from D12's refusal to convert.

**Marking a trip settled is refused while anyone is still owed.** Writing off a
difference is itself a payment, and recording it is cheaper than letting "settled" mean
nothing. An owner may **reopen** a settled trip, which unlocks its expenses.

## Consequences
- **Every settlement read runs four aggregate queries.** Fine at trip scale — tens of
  expenses, single-digit participants — and it would be the first thing to cache if a
  trip ever got large. Correctness bought with a cost that is currently invisible.
- **The plan is not the shortest possible one.** For adversarial balance sets a better
  plan exists. Nobody will notice at six people, and the `n − 1` bound is guaranteed.
- **Reopening is a real hole in D14's immutability.** A settled trip is read-only only
  for as long as its owner leaves it settled; there is no record that it was reopened,
  nor of what changed afterwards. That is the accepted cost of locking instead of
  versioning, and it is the thing to fix first if expense history ever matters.
- **Requiring zero outstanding makes settling a two-step act** — record the payments,
  then settle — which is more friction than a single button. It is deliberate: the
  alternative is a "settled" flag that says nothing about whether anyone was paid.
- **Private expenses are excluded from balances entirely**, since they have no shares and
  counting them would make their payer a creditor of nobody.
- **A participant cannot be removed once they appear in a settlement**, because the
  foreign keys are `restrict` rather than `set null`. That is correct — deleting half of
  a payment is worse than refusing — but the error will surface as a constraint
  violation rather than a considered message until a handler catches it.
