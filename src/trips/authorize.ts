import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { getDb } from "../db/client.ts";
import { tripParticipants, trips } from "../db/schema.ts";
import type { ParticipantRole } from "../db/schema.ts";

export type Membership = { participantId: string; role: ParticipantRole };

/**
 * Trip authorisation is membership, not ownership: every participant holding
 * an account can see the trip, and `owner` additionally manages seats,
 * invites and the trip record itself.
 */
export async function membershipFor(
  tripId: string,
  userId: string,
): Promise<Membership | undefined> {
  const [row] = await getDb()
    .select({ participantId: tripParticipants.id, role: tripParticipants.role })
    .from(tripParticipants)
    .where(and(eq(tripParticipants.tripId, tripId), eq(tripParticipants.userId, userId)))
    .limit(1);

  return row;
}

/**
 * 404 for both "no such trip" and "not a trip of yours". A 403 would confirm
 * the trip exists, which is information the caller has not earned.
 */
export const tripNotFound = (c: Context) => c.json({ error: "trip not found" }, 404);

/**
 * When the money was declared done. Once set, expenses and recorded payments
 * are read-only (D14): v1 locks rather than versioning, because editing a
 * settled expense would corrupt a balance someone has already paid against.
 */
export async function settledAtFor(tripId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ settledAt: trips.settledAt })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  return row?.settledAt ?? null;
}

/** 409 rather than 403: the request is fine, the trip's state refuses it. */
export const tripIsSettled = (c: Context) =>
  c.json({ error: "this trip is settled; reopen it to change the money" }, 409);
