import { randomBytes } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { publicScheme } from "../config.ts";
import { getDb } from "../db/client.ts";
import {
  dayEntries,
  places,
  tripDayLocations,
  tripDays,
  tripLocations,
  trips,
} from "../db/schema.ts";

const TOKEN_BYTES = 24;

/**
 * A read-only view of a trip for anyone holding the link.
 *
 * What travels is deliberately narrow: the itinerary and nothing
 * transactional. No expenses, balances or settlements; no booking providers or
 * confirmation codes; no participants, and so no attendance. Entry notes are
 * left behind too, since those tend to hold logistics meant for the group.
 * Day notes do travel — they are the narrative of the day. See ADR-0011.
 */
export const shareRoutes = new Hono()
  .get("/:token", async (c) => {
    const [trip] = await getDb()
      .select({
        id: trips.id,
        name: trips.name,
        startDate: trips.startDate,
        endDate: trips.endDate,
        status: trips.status,
      })
      .from(trips)
      .where(eq(trips.shareToken, c.req.param("token")))
      .limit(1);

    // The same answer for a revoked link and one that never existed.
    if (trip === undefined) return c.json({ error: "this link is not available" }, 404);

    const days = await getDb()
      .select({
        id: tripDays.id,
        dayNumber: tripDays.dayNumber,
        date: tripDays.date,
        notes: tripDays.notes,
      })
      .from(tripDays)
      .where(eq(tripDays.tripId, trip.id))
      .orderBy(asc(tripDays.dayNumber));

    const dayIds = days.map((d) => d.id);

    const [areas, dayAreas, entries] = await Promise.all([
      getDb()
        .select({ id: tripLocations.id, name: tripLocations.name })
        .from(tripLocations)
        .where(eq(tripLocations.tripId, trip.id))
        .orderBy(asc(tripLocations.createdAt)),

      dayIds.length === 0
        ? []
        : getDb()
            .select({ dayId: tripDayLocations.dayId, name: tripLocations.name })
            .from(tripDayLocations)
            .innerJoin(tripLocations, eq(tripLocations.id, tripDayLocations.locationId))
            .where(inArray(tripDayLocations.dayId, dayIds))
            .orderBy(asc(tripDayLocations.position)),

      dayIds.length === 0
        ? []
        : getDb()
            .select({
              dayId: dayEntries.dayId,
              kind: dayEntries.kind,
              title: dayEntries.title,
              startsAt: dayEntries.startsAt,
              status: dayEntries.status,
              placeName: places.name,
              // The id itself would be meaningless here; whether it was
              // replaced is the part worth reading.
              replaced: sql<boolean>`${dayEntries.replacedByEntryId} is not null`,
            })
            .from(dayEntries)
            .leftJoin(places, eq(places.id, dayEntries.placeId))
            .where(inArray(dayEntries.dayId, dayIds))
            .orderBy(sql`${dayEntries.startsAt} asc nulls last`, asc(dayEntries.position)),
    ]);

    const dayCount = new Map<string, number>();
    for (const row of dayAreas) dayCount.set(row.name, (dayCount.get(row.name) ?? 0) + 1);

    return c.json({
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      status: trip.status,
      areas: areas.map((a) => ({ name: a.name, dayCount: dayCount.get(a.name) ?? 0 })),
      days: days.map((day) => ({
        dayNumber: day.dayNumber,
        date: day.date,
        notes: day.notes,
        locations: dayAreas.filter((a) => a.dayId === day.id).map((a) => a.name),
        entries: entries
          .filter((e) => e.dayId === day.id)
          .map(({ dayId, ...entry }) => entry),
      })),
    });
  });

/** The link an owner copies. Built from configuration, not X-Forwarded-Proto. */
export const shareUrlFor = (host: string, token: string): string =>
  `${publicScheme()}://${host}/s/${token}`;

export const newShareToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url");
