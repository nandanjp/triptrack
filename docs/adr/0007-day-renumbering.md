# ADR-0007 — Move day numbers and dates through non-colliding values, rather than deferring the constraints

**Status:** Accepted · 2026-10-04

## Context
`DOMAIN.md` D3 makes `day_number` the stable identity of a day and `date` an attribute,
specifically so that **shifting a whole trip** and **inserting a day mid-trip** are both
cheap. Two uniqueness rules protect that model: a trip cannot hold two day 3s, and it
cannot hold two days on the same date.

Both are enforced as unique *indexes*, and Postgres checks a unique index **per row as an
UPDATE proceeds**, not at statement end. So any bulk move whose source and destination
ranges overlap fails partway through:

- Inserting at day 2 means `day_number = day_number + 1` for days 2, 3, 4 — and the first
  row written collides with the day 3 that has not moved yet.
- Shifting a trip one day later means every date lands on the value its neighbour still
  holds.

Three ways out were real:

- **A deferrable unique constraint.** The textbook answer: `SET CONSTRAINTS ALL DEFERRED`
  moves the check to commit. Rejected because only a unique *constraint* can be deferred,
  not a unique index, and Drizzle emits indexes — adopting it means hand-editing generated
  migrations and keeping the snapshot in step with SQL Drizzle did not write.
- **Dropping the uniqueness.** Rejected outright: a trip with two day 3s is a worse
  problem than any workaround.
- **Two statements through values that cannot collide.** Chosen.

## Decision
Every overlapping bulk move runs as two UPDATEs inside a transaction, passing through a
range nothing real occupies:

- **Day numbers** go negative and come back: `day_number → -(day_number ± 1)`, then
  `→ -day_number`. Negatives cannot collide with the positives left behind.
- **Dates** are parked 100,000 days out and brought back with the shift applied, which is
  far enough that no intermediate value meets a real one.

Because `day_number` passes through negative values, there is deliberately **no CHECK
constraint requiring it to be positive**; the range is validated in the application.

Date arithmetic casts its operand: `date + $1` leaves Postgres unable to choose between
`date + integer` and `date + interval` and fails with *operator is not unique: date +
unknown*, because Drizzle parameterises interpolated numbers.

## Consequences
- **A reader will wonder why the numbers go negative.** It looks like a bug and is not,
  so both helpers carry the explanation. This is the main cost: cleverness that has to be
  commented is a liability.
- **The intermediate state is never visible**, since both statements share a transaction.
  A crash between them rolls back.
- **It only works because the constraint is per-trip.** Two trips renumbering at once do
  not interact. A future constraint spanning trips would need rethinking.
- **The 100,000-day park is arbitrary but safe** — roughly 274 years, against a Postgres
  `date` ceiling in the year 5874897. It breaks only for a trip already dated past the
  year 275000, which is not a trip.
- **A literal in a SQL template needs no cast, an interpolated value does.** That
  asymmetry is invisible until it fails, and it failed once here: the day-number helpers
  worked immediately while the date shift returned 500 until cast. Any future date
  arithmetic has the same trap.
- **Deferrable constraints remain the better answer if this spreads.** If a third
  overlapping move appears, the right move is to switch to constraints and accept the
  hand-written migrations, rather than add a third offset trick.
