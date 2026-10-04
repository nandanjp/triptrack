import { and, eq, gte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema.ts";
import { tripDays, trips } from "../db/schema.ts";

type Db = PostgresJsDatabase<typeof schema>;
/** The handle Drizzle hands a transaction callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Both `(trip_id, day_number)` and `(trip_id, date)` are unique *indexes*, and
 * Postgres checks those per row as an UPDATE proceeds — not at statement end.
 * A unique CONSTRAINT could be deferred; an index cannot, and Drizzle emits
 * indexes.
 *
 * So any bulk move whose source and destination ranges overlap has to pass
 * through values that cannot collide, in two statements. Renumbering uses
 * negatives; date shifts use a large offset. Both are inside a transaction, so
 * the intermediate state is never visible.
 *
 * The alternative — dropping the constraints — would let a trip hold two
 * day 3s, which is worse than this comment.
 */

/** Days are never negative in practice; this is only reachable mid-transaction. */
const DATE_PARK_DAYS = 100_000;

/**
 * Drizzle parameterises an interpolated number, and `date + $1` leaves
 * Postgres unable to choose between `date + integer` and `date + interval`:
 * it fails with "operator is not unique: date + unknown". The cast resolves
 * the overload. Column-to-literal arithmetic in a template needs no cast,
 * which is why the day-number renumbering above does without one.
 */
const asDays = (n: number) => sql`${n}::int`;

/** Opens a gap at `atDayNumber` by pushing that day and everything after it up one. */
export async function openGapAt(tx: Tx, tripId: string, atDayNumber: number): Promise<void> {
  await tx
    .update(tripDays)
    .set({ dayNumber: sql`-(${tripDays.dayNumber} + 1)` })
    .where(and(eq(tripDays.tripId, tripId), gte(tripDays.dayNumber, atDayNumber)));

  await tx
    .update(tripDays)
    .set({ dayNumber: sql`-${tripDays.dayNumber}` })
    .where(and(eq(tripDays.tripId, tripId), sql`${tripDays.dayNumber} < 0`));
}

/** Closes the gap left by deleting `removedDayNumber`. */
export async function closeGapAt(tx: Tx, tripId: string, removedDayNumber: number): Promise<void> {
  await tx
    .update(tripDays)
    .set({ dayNumber: sql`-(${tripDays.dayNumber} - 1)` })
    .where(and(eq(tripDays.tripId, tripId), gte(tripDays.dayNumber, removedDayNumber)));

  await tx
    .update(tripDays)
    .set({ dayNumber: sql`-${tripDays.dayNumber}` })
    .where(and(eq(tripDays.tripId, tripId), sql`${tripDays.dayNumber} < 0`));
}

/**
 * Moves every dated day, and the trip's own range, by `byDays`. This is a
 * first-class operation rather than a migration script because a trip moving
 * by a week is ordinary (D3).
 */
export async function shiftTripDates(tx: Tx, tripId: string, byDays: number): Promise<void> {
  if (byDays === 0) return;

  // Park far from the real range so no intermediate value collides.
  await tx
    .update(tripDays)
    .set({ date: sql`${tripDays.date} + ${asDays(DATE_PARK_DAYS)}` })
    .where(and(eq(tripDays.tripId, tripId), sql`${tripDays.date} is not null`));

  await tx
    .update(tripDays)
    .set({ date: sql`${tripDays.date} - ${asDays(DATE_PARK_DAYS - byDays)}` })
    .where(and(eq(tripDays.tripId, tripId), sql`${tripDays.date} is not null`));

  // The trip's own dates have no uniqueness to trip over, so one statement.
  await tx
    .update(trips)
    .set({
      startDate: sql`${trips.startDate} + ${asDays(byDays)}`,
      endDate: sql`${trips.endDate} + ${asDays(byDays)}`,
    })
    .where(eq(trips.id, tripId));
}
