import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { jsonBody } from "../http/validate.ts";
import type { Context } from "hono";
import { z } from "zod";
import { requireSession, type AuthenticatedEnv } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import {
  BOOKING_KINDS,
  BOOKING_STATUSES,
  bookings,
  tripDayBookings,
  tripDays,
} from "../db/schema.ts";
import { membershipFor, tripNotFound } from "../trips/authorize.ts";

const instant = z.string().datetime({ offset: true });

const bookingFields = {
  kind: z.enum(BOOKING_KINDS),
  title: z.string().trim().min(1).max(300),
  provider: z.string().trim().max(200).nullish(),
  confirmationCode: z.string().trim().max(200).nullish(),
  startsAt: instant,
  endsAt: instant.nullish(),
  locationId: z.string().uuid().nullish(),
  status: z.enum(BOOKING_STATUSES).optional(),
  notes: z.string().max(10_000).nullish(),
};

/** A booking that ends before it begins is a typo. */
const ordered = <T extends { startsAt?: string; endsAt?: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  const { startsAt, endsAt } = value;
  if (startsAt !== undefined && endsAt != null && endsAt < startsAt) {
    ctx.addIssue({ code: "custom", message: "endsAt cannot be before startsAt", path: ["endsAt"] });
  }
};

const newBooking = z.object(bookingFields).superRefine(ordered);
const patchBooking = z.object(bookingFields).partial().superRefine(ordered);

async function requireMember(c: Context<AuthenticatedEnv>): Promise<string | undefined> {
  const tripId = c.req.param("tripId");
  if (tripId === undefined) return undefined;

  const membership = await membershipFor(tripId, c.get("userId"));
  return membership === undefined ? undefined : tripId;
}

const bookingOnTrip = async (bookingId: string, tripId: string) => {
  const [row] = await getDb()
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tripId, tripId)))
    .limit(1);
  return row;
};

const dayOnTrip = async (dayId: string, tripId: string) => {
  const [row] = await getDb()
    .select({ id: tripDays.id })
    .from(tripDays)
    .where(and(eq(tripDays.id, dayId), eq(tripDays.tripId, tripId)))
    .limit(1);
  return row;
};

export const bookingRoutes = new Hono<AuthenticatedEnv>()
  .use("*", requireSession())

  .get("/:tripId/bookings", async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const rows = await getDb()
      .select()
      .from(bookings)
      .where(eq(bookings.tripId, tripId))
      .orderBy(asc(bookings.startsAt));

    // How many days actually use each booking. Paid-for nights exceeding used
    // nights is the "booked the whole trip, slept there three nights" case —
    // surfaced as information, never corrected automatically.
    const [lodgingUse, otherUse] = await Promise.all([
      getDb()
        .select({ bookingId: tripDays.lodgingBookingId, used: sql<number>`count(*)::int` })
        .from(tripDays)
        .where(and(eq(tripDays.tripId, tripId), sql`${tripDays.lodgingBookingId} is not null`))
        .groupBy(tripDays.lodgingBookingId),

      getDb()
        .select({ bookingId: tripDayBookings.bookingId, used: sql<number>`count(*)::int` })
        .from(tripDayBookings)
        .innerJoin(tripDays, eq(tripDays.id, tripDayBookings.dayId))
        .where(eq(tripDays.tripId, tripId))
        .groupBy(tripDayBookings.bookingId),
    ]);

    const used = new Map<string, number>();
    for (const row of [...lodgingUse, ...otherUse]) {
      if (row.bookingId !== null) used.set(row.bookingId, row.used);
    }

    return c.json(rows.map((b) => ({ ...b, usedDayCount: used.get(b.id) ?? 0 })));
  })

  .post("/:tripId/bookings", jsonBody(newBooking), async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const input = c.req.valid("json");

    const [created] = await getDb()
      .insert(bookings)
      .values({
        tripId,
        kind: input.kind,
        title: input.title,
        provider: input.provider ?? null,
        confirmationCode: input.confirmationCode ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt == null ? null : new Date(input.endsAt),
        locationId: input.locationId ?? null,
        notes: input.notes ?? null,
        ...(input.status === undefined ? {} : { status: input.status }),
      })
      .returning();

    return c.json(created, 201);
  })

  .patch("/:tripId/bookings/:bookingId", jsonBody(patchBooking), async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const bookingId = c.req.param("bookingId");
    const existing = await bookingOnTrip(bookingId, tripId);
    if (existing === undefined) return c.json({ error: "booking not found" }, 404);

    const input = c.req.valid("json");

    // Dates are validated pairwise, so a patch touching one has to be checked
    // against what is stored.
    const startsAt = input.startsAt === undefined ? existing.startsAt : new Date(input.startsAt);
    const endsAt =
      input.endsAt === undefined ? existing.endsAt : input.endsAt === null ? null : new Date(input.endsAt);

    if (endsAt !== null && endsAt.getTime() < startsAt.getTime()) {
      return c.json({ error: "endsAt cannot be before startsAt" }, 400);
    }

    // Changing kind away from lodging would orphan any day pointing at it as
    // a place to sleep, and vice versa.
    if (input.kind !== undefined && input.kind !== existing.kind) {
      if ((await usageOf(bookingId, tripId)) > 0) {
        return c.json({ error: "unlink this booking from its days before changing its kind" }, 409);
      }
    }

    const [updated] = await getDb()
      .update(bookings)
      .set({
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.confirmationCode === undefined ? {} : { confirmationCode: input.confirmationCode }),
        ...(input.startsAt === undefined ? {} : { startsAt }),
        ...(input.endsAt === undefined ? {} : { endsAt }),
        ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    return c.json(updated);
  })

  .delete("/:tripId/bookings/:bookingId", async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const deleted = await getDb()
      .delete(bookings)
      .where(and(eq(bookings.id, c.req.param("bookingId")), eq(bookings.tripId, tripId)))
      .returning({ id: bookings.id });

    // Day links cascade and the lodging column nulls out, so a day survives
    // losing the booking it pointed at.
    return deleted.length === 0 ? c.json({ error: "booking not found" }, 404) : c.body(null, 204);
  })

  /**
   * Where I sleep at the end of this day. Single-valued, and chosen rather
   * than derived: a booking's range is what was paid for, which differs from
   * what was used whenever a stay is cancelled midway or booked long and used
   * briefly (D5, D6).
   */
  .put(
    "/:tripId/days/:dayId/lodging",
    jsonBody(z.object({ bookingId: z.string().uuid().nullable() })),
    async (c) => {
      const tripId = await requireMember(c);
      if (tripId === undefined) return tripNotFound(c);

      const dayId = c.req.param("dayId");
      if ((await dayOnTrip(dayId, tripId)) === undefined) {
        return c.json({ error: "day not found" }, 404);
      }

      const { bookingId } = c.req.valid("json");

      if (bookingId !== null) {
        const booking = await bookingOnTrip(bookingId, tripId);
        if (booking === undefined) return c.json({ error: "booking not found" }, 404);
        if (booking.kind !== "lodging") {
          return c.json({ error: "only a lodging booking can be a place to sleep" }, 400);
        }
        // A cancelled booking stays assignable on purpose: you may well have
        // slept there before cancelling the rest of the stay.
      }

      const [updated] = await getDb()
        .update(tripDays)
        .set({ lodgingBookingId: bookingId })
        .where(eq(tripDays.id, dayId))
        .returning({ id: tripDays.id, lodgingBookingId: tripDays.lodgingBookingId });

      return c.json(updated);
    },
  )

  /** Transit and event bookings used on a day. The list is the state. */
  .put(
    "/:tripId/days/:dayId/bookings",
    jsonBody(z.object({ bookingIds: z.array(z.string().uuid()).max(20) })),
    async (c) => {
      const tripId = await requireMember(c);
      if (tripId === undefined) return tripNotFound(c);

      const dayId = c.req.param("dayId");
      if ((await dayOnTrip(dayId, tripId)) === undefined) {
        return c.json({ error: "day not found" }, 404);
      }

      const { bookingIds } = c.req.valid("json");

      if (bookingIds.length > 0) {
        const found = await getDb()
          .select({ id: bookings.id, kind: bookings.kind })
          .from(bookings)
          .where(and(eq(bookings.tripId, tripId), inArray(bookings.id, bookingIds)));

        if (found.length !== new Set(bookingIds).size) {
          return c.json({ error: "one or more bookings are not on this trip" }, 400);
        }
        if (found.some((b) => b.kind === "lodging")) {
          return c.json({ error: "lodging is set per night, not in this list" }, 400);
        }
      }

      await getDb().transaction(async (tx) => {
        await tx.delete(tripDayBookings).where(eq(tripDayBookings.dayId, dayId));
        if (bookingIds.length > 0) {
          await tx
            .insert(tripDayBookings)
            .values([...new Set(bookingIds)].map((bookingId) => ({ dayId, bookingId })));
        }
      });

      return c.json({ dayId, bookingIds: [...new Set(bookingIds)] });
    },
  );

/** Days that reference this booking, either as lodging or as transit/event. */
async function usageOf(bookingId: string, tripId: string): Promise<number> {
  const [asLodging] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(tripDays)
    .where(and(eq(tripDays.tripId, tripId), eq(tripDays.lodgingBookingId, bookingId)));

  const [asOther] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(tripDayBookings)
    .innerJoin(tripDays, eq(tripDays.id, tripDayBookings.dayId))
    .where(and(eq(tripDays.tripId, tripId), eq(tripDayBookings.bookingId, bookingId)));

  return (asLodging?.n ?? 0) + (asOther?.n ?? 0);
}
