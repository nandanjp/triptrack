import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { requireSession, type AuthenticatedEnv } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import {
  bookings,
  dayEntries,
  dayEntryAttendees,
  ENTRY_KINDS,
  ENTRY_STATUSES,
  places,
  tripDayBookings,
  tripDayLocations,
  tripDays,
  tripLocations,
  tripParticipants,
} from "../db/schema.ts";
import { membershipFor, tripNotFound } from "../trips/authorize.ts";
import { closeGapAt, openGapAt, shiftTripDates } from "./day-numbering.ts";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const clockTime = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM");

const placeInput = z.object({
  name: z.string().trim().min(1).max(200),
  externalRef: z.string().trim().min(1).max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  country: z.string().trim().length(2).optional(),
});

const newDay = z.object({
  date: localDate.nullish(),
  notes: z.string().max(10_000).nullish(),
  locationIds: z.array(z.string().uuid()).max(10).optional(),
  /** Omit to append; supply to insert, pushing that day and later ones down. */
  atDayNumber: z.number().int().positive().optional(),
});

const patchDay = z.object({
  date: localDate.nullish(),
  notes: z.string().max(10_000).nullish(),
  locationIds: z.array(z.string().uuid()).max(10).optional(),
});

const patchEntry = z.object({
  kind: z.enum(ENTRY_KINDS).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  startsAt: clockTime.nullish(),
  notes: z.string().max(10_000).nullish(),
  place: placeInput.nullish(),
});

const patchStatus = z.object({
  status: z.enum(ENTRY_STATUSES),
  /** The beach you went to when the museum was closed. */
  replacedByEntryId: z.string().uuid().nullish(),
});

const newEntry = z.object({
  kind: z.enum(ENTRY_KINDS),
  title: z.string().trim().min(1).max(300),
  startsAt: clockTime.nullish(),
  notes: z.string().max(10_000).nullish(),
  /**
   * A spontaneous find is created directly as `done` — not a separate
   * concept, just an entry born in that state (D2).
   */
  status: z.enum(ENTRY_STATUSES).optional(),
  place: placeInput.optional(),
  /** Defaults to every current participant; materialised, never implied (D9). */
  attendeeIds: z.array(z.string().uuid()).optional(),
});

/**
 * Itinerary editing is open to every member, not just the owner: a trip is
 * planned by the group. Owner-only remains for trip settings and seats.
 */
async function requireMember(c: Context<AuthenticatedEnv>): Promise<string | undefined> {
  // Generic Context means the param is not statically known to exist.
  const tripId = c.req.param("tripId");
  if (tripId === undefined) return undefined;

  const membership = await membershipFor(tripId, c.get("userId"));
  return membership === undefined ? undefined : tripId;
}

/**
 * Entries are addressed by id without the day in the path, so ownership has
 * to be checked by joining back up to the trip.
 */
async function entryBelongsToTrip(entryId: string, tripId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: dayEntries.id })
    .from(dayEntries)
    .innerJoin(tripDays, eq(tripDays.id, dayEntries.dayId))
    .where(and(eq(dayEntries.id, entryId), eq(tripDays.tripId, tripId)))
    .limit(1);

  return row !== undefined;
}

/** Reuses a place by external id where there is one; otherwise adds a row. */
async function resolvePlace(input: z.infer<typeof placeInput>): Promise<string> {
  if (input.externalRef !== undefined) {
    const [existing] = await getDb()
      .select({ id: places.id })
      .from(places)
      .where(eq(places.externalRef, input.externalRef))
      .limit(1);
    if (existing !== undefined) return existing.id;
  }

  const [created] = await getDb().insert(places).values(input).returning({ id: places.id });
  if (created === undefined) throw new Error("place insert returned no row");
  return created.id;
}

export const itineraryRoutes = new Hono<AuthenticatedEnv>()
  .use("*", requireSession())

  .get("/:tripId/locations", async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const rows = await getDb()
      .select()
      .from(tripLocations)
      .where(eq(tripLocations.tripId, tripId))
      .orderBy(asc(tripLocations.createdAt));

    // Day counts are derived, never stored: "7 days in Seoul" is a
    // consequence of the itinerary, not a constraint on it.
    const counts = await getDb()
      .select({ locationId: tripDayLocations.locationId, days: sql<number>`count(*)::int` })
      .from(tripDayLocations)
      .innerJoin(tripDays, eq(tripDays.id, tripDayLocations.dayId))
      .where(eq(tripDays.tripId, tripId))
      .groupBy(tripDayLocations.locationId);

    const byId = new Map(counts.map((r) => [r.locationId, r.days]));
    return c.json(rows.map((l) => ({ ...l, dayCount: byId.get(l.id) ?? 0 })));
  })

  .post(
    "/:tripId/locations",
    zValidator("json", z.object({ name: z.string().trim().min(1).max(200), lat: z.number().optional(), lng: z.number().optional() })),
    async (c) => {
      const tripId = await requireMember(c);
      if (tripId === undefined) return tripNotFound(c);

      const [location] = await getDb()
        .insert(tripLocations)
        .values({ tripId, ...c.req.valid("json") })
        .returning();

      return c.json(location, 201);
    },
  )

  .get("/:tripId/days", async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const days = await getDb()
      .select()
      .from(tripDays)
      .where(eq(tripDays.tripId, tripId))
      .orderBy(asc(tripDays.dayNumber));

    if (days.length === 0) return c.json([]);
    const dayIds = days.map((d) => d.id);

    const [locations, entries, attendees, dayBookings, lodging] = await Promise.all([
      getDb()
        .select({
          dayId: tripDayLocations.dayId,
          id: tripLocations.id,
          name: tripLocations.name,
          position: tripDayLocations.position,
        })
        .from(tripDayLocations)
        .innerJoin(tripLocations, eq(tripLocations.id, tripDayLocations.locationId))
        .where(inArray(tripDayLocations.dayId, dayIds))
        .orderBy(asc(tripDayLocations.position)),

      getDb()
        .select({
          id: dayEntries.id,
          dayId: dayEntries.dayId,
          kind: dayEntries.kind,
          title: dayEntries.title,
          startsAt: dayEntries.startsAt,
          status: dayEntries.status,
          notes: dayEntries.notes,
          position: dayEntries.position,
          replacedByEntryId: dayEntries.replacedByEntryId,
          placeId: dayEntries.placeId,
          placeName: places.name,
        })
        .from(dayEntries)
        .leftJoin(places, eq(places.id, dayEntries.placeId))
        .where(inArray(dayEntries.dayId, dayIds))
        // Timed entries in clock order, untimed ones after, by position.
        .orderBy(sql`${dayEntries.startsAt} asc nulls last`, asc(dayEntries.position)),

      getDb()
        .select({
          entryId: dayEntryAttendees.entryId,
          participantId: dayEntryAttendees.participantId,
          displayName: tripParticipants.displayName,
        })
        .from(dayEntryAttendees)
        .innerJoin(tripParticipants, eq(tripParticipants.id, dayEntryAttendees.participantId))
        .innerJoin(dayEntries, eq(dayEntries.id, dayEntryAttendees.entryId))
        .where(inArray(dayEntries.dayId, dayIds)),

      // Transit and event bookings used on each day.
      getDb()
        .select({
          dayId: tripDayBookings.dayId,
          id: bookings.id,
          kind: bookings.kind,
          title: bookings.title,
          status: bookings.status,
          startsAt: bookings.startsAt,
        })
        .from(tripDayBookings)
        .innerJoin(bookings, eq(bookings.id, tripDayBookings.bookingId))
        .where(inArray(tripDayBookings.dayId, dayIds))
        .orderBy(asc(bookings.startsAt)),

      // Where each night is spent. Single-valued per day (D6).
      getDb()
        .select({
          dayId: tripDays.id,
          id: bookings.id,
          title: bookings.title,
          status: bookings.status,
        })
        .from(tripDays)
        .innerJoin(bookings, eq(bookings.id, tripDays.lodgingBookingId))
        .where(inArray(tripDays.id, dayIds)),
    ]);

    const attendeesByEntry = new Map<string, { participantId: string; displayName: string }[]>();
    for (const a of attendees) {
      const list = attendeesByEntry.get(a.entryId) ?? [];
      list.push({ participantId: a.participantId, displayName: a.displayName });
      attendeesByEntry.set(a.entryId, list);
    }

    return c.json(
      days.map((day) => ({
        ...day,
        locations: locations.filter((l) => l.dayId === day.id).map(({ id, name }) => ({ id, name })),
        lodging: lodging.find((l) => l.dayId === day.id) ?? null,
        bookings: dayBookings.filter((b) => b.dayId === day.id),
        entries: entries
          .filter((e) => e.dayId === day.id)
          .map((e) => ({ ...e, attendees: attendeesByEntry.get(e.id) ?? [] })),
      })),
    );
  })

  .post("/:tripId/days", zValidator("json", newDay), async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const { date, notes, locationIds, atDayNumber } = c.req.valid("json");

    const day = await getDb().transaction(async (tx) => {
      const [{ next } = { next: 1 }] = await tx
        .select({ next: sql<number>`coalesce(max(${tripDays.dayNumber}), 0) + 1` })
        .from(tripDays)
        .where(eq(tripDays.tripId, tripId));

      let dayNumber = next;
      if (atDayNumber !== undefined && atDayNumber < next) {
        await openGapAt(tx, tripId, atDayNumber);
        dayNumber = atDayNumber;
      }

      const [created] = await tx
        .insert(tripDays)
        .values({ tripId, dayNumber, date: date ?? null, notes: notes ?? null })
        .returning();

      if (created === undefined) throw new Error("day insert returned no row");

      if (locationIds !== undefined && locationIds.length > 0) {
        await tx.insert(tripDayLocations).values(
          locationIds.map((locationId, position) => ({ dayId: created.id, locationId, position })),
        );
      }

      return created;
    });

    return c.json(day, 201);
  })

  .post(
    "/:tripId/days/shift",
    zValidator("json", z.object({ byDays: z.number().int().gte(-3650).lte(3650) })),
    async (c) => {
      const tripId = await requireMember(c);
      if (tripId === undefined) return tripNotFound(c);

      await getDb().transaction((tx) => shiftTripDates(tx, tripId, c.req.valid("json").byDays));
      return c.json({ status: "shifted" });
    },
  )

  .delete("/:tripId/days/:dayId", async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const dayId = c.req.param("dayId");

    const removed = await getDb().transaction(async (tx) => {
      const [day] = await tx
        .select()
        .from(tripDays)
        .where(and(eq(tripDays.id, dayId), eq(tripDays.tripId, tripId)))
        .limit(1);

      if (day === undefined) return false;

      await tx.delete(tripDays).where(eq(tripDays.id, dayId));
      // Keep day numbers contiguous, or "day 4" stops meaning the fourth day.
      await closeGapAt(tx, tripId, day.dayNumber);
      return true;
    });

    return removed ? c.body(null, 204) : c.json({ error: "day not found" }, 404);
  })

  .post("/:tripId/days/:dayId/entries", zValidator("json", newEntry), async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const dayId = c.req.param("dayId");
    const input = c.req.valid("json");

    const [day] = await getDb()
      .select({ id: tripDays.id })
      .from(tripDays)
      .where(and(eq(tripDays.id, dayId), eq(tripDays.tripId, tripId)))
      .limit(1);

    if (day === undefined) return c.json({ error: "day not found" }, 404);

    const placeId = input.place === undefined ? null : await resolvePlace(input.place);

    // Default attendance is every current participant, captured now. An
    // implied "everyone" would retroactively include someone who joins later.
    const currentParticipants = await getDb()
      .select({ id: tripParticipants.id })
      .from(tripParticipants)
      .where(eq(tripParticipants.tripId, tripId));

    const allowed = new Set(currentParticipants.map((p) => p.id));
    const requested = input.attendeeIds ?? [...allowed];
    const attendeeIds = requested.filter((id) => allowed.has(id));

    if (input.attendeeIds !== undefined && attendeeIds.length !== input.attendeeIds.length) {
      return c.json({ error: "one or more attendees are not on this trip" }, 400);
    }

    const entry = await getDb().transaction(async (tx) => {
      const [{ next } = { next: 0 }] = await tx
        .select({ next: sql<number>`coalesce(max(${dayEntries.position}), -1) + 1` })
        .from(dayEntries)
        .where(eq(dayEntries.dayId, dayId));

      const [created] = await tx
        .insert(dayEntries)
        .values({
          dayId,
          kind: input.kind,
          title: input.title,
          startsAt: input.startsAt ?? null,
          notes: input.notes ?? null,
          placeId,
          position: next,
          ...(input.status === undefined ? {} : { status: input.status }),
        })
        .returning();

      if (created === undefined) throw new Error("entry insert returned no row");

      if (attendeeIds.length > 0) {
        await tx
          .insert(dayEntryAttendees)
          .values(attendeeIds.map((participantId) => ({ entryId: created.id, participantId })));
      }

      return created;
    });

    return c.json({ ...entry, attendeeIds }, 201);
  })

  .patch("/:tripId/days/:dayId", zValidator("json", patchDay), async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const dayId = c.req.param("dayId");
    const { date, notes, locationIds } = c.req.valid("json");

    const updated = await getDb().transaction(async (tx) => {
      const [day] = await tx
        .select()
        .from(tripDays)
        .where(and(eq(tripDays.id, dayId), eq(tripDays.tripId, tripId)))
        .limit(1);

      if (day === undefined) return undefined;

      if (date !== undefined || notes !== undefined) {
        await tx
          .update(tripDays)
          .set({
            ...(date === undefined ? {} : { date }),
            ...(notes === undefined ? {} : { notes }),
          })
          .where(eq(tripDays.id, dayId));
      }

      // Replace wholesale: the array is ordered, so a diff would have to
      // rewrite the positions anyway.
      if (locationIds !== undefined) {
        await tx.delete(tripDayLocations).where(eq(tripDayLocations.dayId, dayId));
        if (locationIds.length > 0) {
          await tx.insert(tripDayLocations).values(
            locationIds.map((locationId, position) => ({ dayId, locationId, position })),
          );
        }
      }

      const [after] = await tx.select().from(tripDays).where(eq(tripDays.id, dayId)).limit(1);
      return after;
    });

    return updated === undefined ? c.json({ error: "day not found" }, 404) : c.json(updated);
  })

  .patch("/:tripId/entries/:entryId", zValidator("json", patchEntry), async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const entryId = c.req.param("entryId");
    if (!(await entryBelongsToTrip(entryId, tripId))) {
      return c.json({ error: "entry not found" }, 404);
    }

    const input = c.req.valid("json");
    // null clears the place; undefined leaves it alone.
    const placeId =
      input.place === undefined ? undefined : input.place === null ? null : await resolvePlace(input.place);

    const patch = {
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(placeId === undefined ? {} : { placeId }),
    };

    if (Object.keys(patch).length === 0) return c.json({ error: "nothing to update" }, 400);

    const [updated] = await getDb()
      .update(dayEntries)
      .set(patch)
      .where(eq(dayEntries.id, entryId))
      .returning();

    return c.json(updated);
  })

  /**
   * The lifecycle, kept separate from editing because changing what happened
   * is a different act from fixing a typo in the title.
   */
  .post("/:tripId/entries/:entryId/status", zValidator("json", patchStatus), async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const entryId = c.req.param("entryId");
    if (!(await entryBelongsToTrip(entryId, tripId))) {
      return c.json({ error: "entry not found" }, 404);
    }

    const { status, replacedByEntryId } = c.req.valid("json");

    if (replacedByEntryId != null) {
      if (replacedByEntryId === entryId) {
        return c.json({ error: "an entry cannot replace itself" }, 400);
      }
      // The replacement may sit on another day, but not on another trip.
      if (!(await entryBelongsToTrip(replacedByEntryId, tripId))) {
        return c.json({ error: "the replacement entry is not on this trip" }, 400);
      }
      if (status === "done" || status === "planned") {
        return c.json({ error: "only a skipped or cancelled entry has a replacement" }, 400);
      }
    }

    const [updated] = await getDb()
      .update(dayEntries)
      .set({
        status,
        ...(replacedByEntryId === undefined ? {} : { replacedByEntryId }),
      })
      .where(eq(dayEntries.id, entryId))
      .returning();

    return c.json(updated);
  })

  /** Replaces the attendee set outright; the list is the state, not a delta. */
  .put(
    "/:tripId/entries/:entryId/attendees",
    zValidator("json", z.object({ participantIds: z.array(z.string().uuid()) })),
    async (c) => {
      const tripId = await requireMember(c);
      if (tripId === undefined) return tripNotFound(c);

      const entryId = c.req.param("entryId");
      if (!(await entryBelongsToTrip(entryId, tripId))) {
        return c.json({ error: "entry not found" }, 404);
      }

      const { participantIds } = c.req.valid("json");

      const onTrip = await getDb()
        .select({ id: tripParticipants.id })
        .from(tripParticipants)
        .where(eq(tripParticipants.tripId, tripId));

      const allowed = new Set(onTrip.map((p) => p.id));
      if (participantIds.some((id) => !allowed.has(id))) {
        return c.json({ error: "one or more attendees are not on this trip" }, 400);
      }

      await getDb().transaction(async (tx) => {
        await tx.delete(dayEntryAttendees).where(eq(dayEntryAttendees.entryId, entryId));
        if (participantIds.length > 0) {
          await tx
            .insert(dayEntryAttendees)
            .values(participantIds.map((participantId) => ({ entryId, participantId })));
        }
      });

      return c.json({ entryId, participantIds });
    },
  )

  .delete("/:tripId/entries/:entryId", async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    const entryId = c.req.param("entryId");
    if (!(await entryBelongsToTrip(entryId, tripId))) {
      return c.json({ error: "entry not found" }, 404);
    }

    await getDb().delete(dayEntries).where(eq(dayEntries.id, entryId));
    return c.body(null, 204);
  })

  .delete("/:tripId/locations/:locationId", async (c) => {
    const tripId = await requireMember(c);
    if (tripId === undefined) return tripNotFound(c);

    // Day links cascade; days themselves survive losing a location label.
    const deleted = await getDb()
      .delete(tripLocations)
      .where(
        and(
          eq(tripLocations.id, c.req.param("locationId")),
          eq(tripLocations.tripId, tripId),
        ),
      )
      .returning({ id: tripLocations.id });

    return deleted.length === 0 ? c.json({ error: "location not found" }, 404) : c.body(null, 204);
  });
