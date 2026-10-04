import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { getDb } from "../db/client.ts";
import { tripParticipants } from "../db/schema.ts";
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
