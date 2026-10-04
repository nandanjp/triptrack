import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { currentUserId, requireSession, type AuthenticatedEnv } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import { isUniqueViolation } from "../db/errors.ts";
import { tripInvites, tripParticipants, trips } from "../db/schema.ts";
import { membershipFor } from "./authorize.ts";
import { hashToken, inviteState } from "./invite-token.ts";

const inviteNotFound = { error: "invite not found" } as const;

export const inviteRoutes = new Hono<AuthenticatedEnv>()
  /**
   * Deliberately unauthenticated: someone following a link needs to see what
   * they are being asked to join before they have an account. Returns only the
   * trip name and the seat's display name — nothing about other participants.
   */
  .get("/:token", async (c) => {
    const [invite] = await getDb()
      .select({
        state: {
          revokedAt: tripInvites.revokedAt,
          claimedAt: tripInvites.claimedAt,
          expiresAt: tripInvites.expiresAt,
        },
        tripName: trips.name,
        seatName: tripParticipants.displayName,
      })
      .from(tripInvites)
      .innerJoin(trips, eq(trips.id, tripInvites.tripId))
      .innerJoin(tripParticipants, eq(tripParticipants.id, tripInvites.participantId))
      .where(eq(tripInvites.tokenHash, hashToken(c.req.param("token"))))
      .limit(1);

    if (invite === undefined) return c.json(inviteNotFound, 404);

    const state = inviteState(invite.state);
    const signedIn = (await currentUserId(c)) !== undefined;

    return c.json({
      state,
      tripName: invite.tripName,
      seatName: invite.seatName,
      // Lets the SPA show "sign in to accept" rather than a dead button.
      signedIn,
    });
  })

  /**
   * Claims the seat the invite was issued for, rather than creating a new
   * participant (ADR-0005). Expenses recorded against that seat before the
   * person signed up therefore stay attached to them.
   */
  .post("/:token/accept", requireSession(), async (c) => {
    const userId = c.get("userId");

    const [invite] = await getDb()
      .select()
      .from(tripInvites)
      .where(eq(tripInvites.tokenHash, hashToken(c.req.param("token"))))
      .limit(1);

    if (invite === undefined) return c.json(inviteNotFound, 404);

    const state = inviteState(invite);
    if (state !== "valid") return c.json({ error: `invite is ${state}` }, 409);

    try {
      const claimed = await getDb().transaction(async (tx) => {
        // Conditional update is the atomic claim: two people racing the same
        // link means one of these affects no rows.
        const marked = await tx
          .update(tripInvites)
          .set({ claimedAt: new Date(), claimedByUserId: userId })
          .where(and(eq(tripInvites.id, invite.id), isNull(tripInvites.claimedAt)))
          .returning({ id: tripInvites.id });

        if (marked.length === 0) return undefined;

        const seat = await tx
          .update(tripParticipants)
          .set({
            userId,
            // Preserved if the owner already recorded a join date.
            joinedOn: invite.createdAt.toISOString().slice(0, 10),
          })
          .where(and(eq(tripParticipants.id, invite.participantId), isNull(tripParticipants.userId)))
          .returning({ id: tripParticipants.id, tripId: tripParticipants.tripId });

        // The invite was valid but its seat was taken another way; roll the
        // claim back rather than consuming the invite for nothing.
        if (seat.length === 0) tx.rollback();

        return seat[0];
      });

      if (claimed === undefined) return c.json({ error: "invite is claimed" }, 409);
      return c.json({ tripId: claimed.tripId, participantId: claimed.id });
    } catch (error: unknown) {
      // The partial unique index on (trip_id, user_id): this account already
      // occupies a different seat on the same trip.
      if (isUniqueViolation(error, "trip_participants_trip_user_unique")) {
        return c.json({ error: "you are already on this trip" }, 409);
      }
      throw error;
    }
  })

  .delete("/:inviteId", requireSession(), async (c) => {
    const [invite] = await getDb()
      .select()
      .from(tripInvites)
      .where(eq(tripInvites.id, c.req.param("inviteId")))
      .limit(1);

    if (invite === undefined) return c.json(inviteNotFound, 404);

    const membership = await membershipFor(invite.tripId, c.get("userId"));
    if (membership === undefined) return c.json(inviteNotFound, 404);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);

    const state = inviteState(invite);
    if (state === "claimed") {
      // Revoking would imply the access is gone, which it is not: remove the
      // participant instead.
      return c.json({ error: "invite is already claimed" }, 409);
    }

    await getDb()
      .update(tripInvites)
      .set({ revokedAt: new Date() })
      .where(eq(tripInvites.id, invite.id));

    return c.body(null, 204);
  });
