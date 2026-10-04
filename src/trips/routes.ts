import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { jsonBody } from "../http/validate.ts";
import { z } from "zod";
import { requireSession, type AuthenticatedEnv } from "../auth/session.ts";
import { publicScheme } from "../config.ts";
import { getDb } from "../db/client.ts";
import {
  PARTICIPANT_ROLES,
  TRIP_STATUSES,
  tripInvites,
  tripParticipants,
  trips,
} from "../db/schema.ts";
import { membershipFor, tripNotFound } from "./authorize.ts";
import { issueToken } from "./invite-token.ts";

/** ISO 8601 calendar date. Local dates, never instants — see DOMAIN.md. */
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** ISO 4217. Stored uppercase so totals group correctly (D12). */
const currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "expected a three-letter currency code")
  .transform((value) => value.toUpperCase());

const tripFields = {
  name: z.string().trim().min(1).max(200),
  startDate: localDate.nullish(),
  endDate: localDate.nullish(),
  status: z.enum(TRIP_STATUSES).optional(),
  homeCurrency: currency.optional(),
};

/** A trip that ends before it starts is a typo, not a trip. */
const orderedDates = <T extends { startDate?: string | null; endDate?: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  const { startDate, endDate } = value;
  if (startDate != null && endDate != null && endDate < startDate) {
    ctx.addIssue({
      code: "custom",
      message: "endDate cannot be before startDate",
      path: ["endDate"],
    });
  }
};

const createTrip = z.object(tripFields).superRefine(orderedDates);
const updateTrip = z.object(tripFields).partial().superRefine(orderedDates);

const patchParticipant = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    role: z.enum(PARTICIPANT_ROLES).optional(),
    joinedOn: localDate.nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

const addParticipant = z.object({
  displayName: z.string().trim().min(1).max(120),
  joinedOn: localDate.nullish(),
});

export const tripRoutes = new Hono<AuthenticatedEnv>()
  .use("*", requireSession())

  .post("/", jsonBody(createTrip), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");

    // One transaction: a trip with no owner would be unmanageable, and the
    // creator's seat is what makes them the owner.
    const trip = await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(trips)
        .values({
          name: input.name,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.homeCurrency === undefined ? {} : { homeCurrency: input.homeCurrency }),
          createdByUserId: userId,
        })
        .returning();

      if (created === undefined) throw new Error("trip insert returned no row");

      await tx.insert(tripParticipants).values({
        tripId: created.id,
        userId,
        // Placeholder until the owner renames their own seat; email would be
        // the obvious default but is not a name.
        displayName: "Me",
        role: "owner",
      });

      return created;
    });

    return c.json(trip, 201);
  })

  .get("/", async (c) => {
    const rows = await getDb()
      .select({
        id: trips.id,
        name: trips.name,
        startDate: trips.startDate,
        endDate: trips.endDate,
        status: trips.status,
        homeCurrency: trips.homeCurrency,
        role: tripParticipants.role,
      })
      .from(trips)
      .innerJoin(tripParticipants, eq(tripParticipants.tripId, trips.id))
      .where(eq(tripParticipants.userId, c.get("userId")))
      /**
       * The app is both planner and log, so one direction is wrong either
       * way: plain DESC puts a trip in 2030 above next week's, plain ASC
       * buries next week under 2019. Three groups instead —
       *
       *   0  current and upcoming, soonest first
       *   1  finished, most recent first
       *   2  undated wishlist trips, newest first
       *
       * `nulls last` must follow `desc`, so these are raw fragments: wrapping
       * one in desc() renders `start_date NULLS LAST DESC` and fails to parse.
       */
      .orderBy(
        sql`case
              when ${trips.startDate} is null then 2
              when coalesce(${trips.endDate}, ${trips.startDate}) >= current_date then 0
              else 1
            end`,
        sql`case
              when coalesce(${trips.endDate}, ${trips.startDate}) >= current_date
              then ${trips.startDate}
            end asc nulls last`,
        sql`${trips.startDate} desc nulls last`,
        desc(trips.createdAt),
      );

    return c.json(rows);
  })

  .get("/:tripId", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);

    const [trip] = await getDb().select().from(trips).where(eq(trips.id, tripId)).limit(1);
    if (trip === undefined) return tripNotFound(c);

    const participants = await getDb()
      .select({
        id: tripParticipants.id,
        displayName: tripParticipants.displayName,
        role: tripParticipants.role,
        joinedOn: tripParticipants.joinedOn,
        // Whether the seat is claimed, without exposing which account holds it.
        hasAccount: sql<boolean>`${tripParticipants.userId} is not null`,
      })
      .from(tripParticipants)
      .where(eq(tripParticipants.tripId, tripId))
      .orderBy(tripParticipants.createdAt);

    // Which seat is the caller's, so the client can default "paid by" to it
    // without being told who occupies the others.
    return c.json({
      ...trip,
      role: membership.role,
      myParticipantId: membership.participantId,
      participants,
    });
  })

  .patch("/:tripId", jsonBody(updateTrip), async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);

    const patch = c.req.valid("json");
    if (Object.keys(patch).length === 0) return c.json({ error: "nothing to update" }, 400);

    // Dates are validated pairwise, so a patch touching only one of them has
    // to be checked against what is already stored.
    const [current] = await getDb().select().from(trips).where(eq(trips.id, tripId)).limit(1);
    if (current === undefined) return tripNotFound(c);

    const startDate = patch.startDate !== undefined ? patch.startDate : current.startDate;
    const endDate = patch.endDate !== undefined ? patch.endDate : current.endDate;
    if (startDate != null && endDate != null && endDate < startDate) {
      return c.json({ error: "endDate cannot be before startDate" }, 400);
    }

    const [updated] = await getDb()
      .update(trips)
      .set(patch)
      .where(eq(trips.id, tripId))
      .returning();

    return c.json(updated);
  })

  .delete("/:tripId", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);

    // Participants and invites cascade; nothing else references a trip yet.
    await getDb().delete(trips).where(eq(trips.id, tripId));
    return c.body(null, 204);
  })

  .post("/:tripId/participants", jsonBody(addParticipant), async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);

    // No userId: a seat exists before, and possibly without ever, being
    // claimed by an account (D8).
    const [participant] = await getDb()
      .insert(tripParticipants)
      .values({ tripId, ...c.req.valid("json") })
      .returning();

    return c.json(participant, 201);
  })

  .delete("/:tripId/participants/:participantId", async (c) => {
    const tripId = c.req.param("tripId");
    const participantId = c.req.param("participantId");

    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);

    const [target] = await getDb()
      .select()
      .from(tripParticipants)
      .where(and(eq(tripParticipants.id, participantId), eq(tripParticipants.tripId, tripId)))
      .limit(1);

    if (target === undefined) return c.json({ error: "participant not found" }, 404);

    // A trip with no owner cannot be administered by anyone, including its
    // own creator, so the last one is not removable.
    if (target.role === "owner") {
      const [counted] = await getDb()
        .select({ owners: sql<number>`count(*)::int` })
        .from(tripParticipants)
        .where(and(eq(tripParticipants.tripId, tripId), eq(tripParticipants.role, "owner")));

      if ((counted?.owners ?? 0) <= 1) {
        return c.json({ error: "a trip must keep at least one owner" }, 409);
      }
    }

    await getDb().delete(tripParticipants).where(eq(tripParticipants.id, participantId));
    return c.body(null, 204);
  })

  /**
   * Renaming a seat is not an owner-only act: the placeholder the creator
   * gets is their own to fix, and a member should not need an owner to
   * correct their name. Changing a *role* is owner-only.
   */
  .patch("/:tripId/participants/:participantId", jsonBody(patchParticipant), async (c) => {
    const tripId = c.req.param("tripId");
    const participantId = c.req.param("participantId");
    const userId = c.get("userId");

    const membership = await membershipFor(tripId, userId);
    if (membership === undefined) return tripNotFound(c);

    const [target] = await getDb()
      .select()
      .from(tripParticipants)
      .where(and(eq(tripParticipants.id, participantId), eq(tripParticipants.tripId, tripId)))
      .limit(1);

    if (target === undefined) return c.json({ error: "participant not found" }, 404);

    const patch = c.req.valid("json");
    const isOwner = membership.role === "owner";
    const isOwnSeat = target.userId === userId;

    if (!isOwner && !isOwnSeat) return c.json({ error: "that is not your seat" }, 403);
    if (patch.role !== undefined && !isOwner) {
      return c.json({ error: "only an owner can change a role" }, 403);
    }

    // Demoting the last owner would leave the trip unadministrable, which is
    // the same invariant that stops the last owner being removed.
    if (patch.role === "member" && target.role === "owner") {
      const [counted] = await getDb()
        .select({ owners: sql<number>`count(*)::int` })
        .from(tripParticipants)
        .where(and(eq(tripParticipants.tripId, tripId), eq(tripParticipants.role, "owner")));

      if ((counted?.owners ?? 0) <= 1) {
        return c.json({ error: "a trip must keep at least one owner" }, 409);
      }
    }

    const [updated] = await getDb()
      .update(tripParticipants)
      .set({
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
        ...(patch.role === undefined ? {} : { role: patch.role }),
        ...(patch.joinedOn === undefined ? {} : { joinedOn: patch.joinedOn }),
      })
      .where(eq(tripParticipants.id, participantId))
      .returning();

    return c.json(updated);
  })

  /**
   * Issues a link for one seat. Single-use follows from being bound to a
   * participant: claiming it fills that seat and nothing more.
   *
   * The plaintext token is returned here and nowhere else — only its hash is
   * stored, so this response is the single opportunity to copy it.
   */
  .post("/:tripId/participants/:participantId/invite", async (c) => {
    const tripId = c.req.param("tripId");
    const participantId = c.req.param("participantId");

    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);

    const [participant] = await getDb()
      .select()
      .from(tripParticipants)
      .where(and(eq(tripParticipants.id, participantId), eq(tripParticipants.tripId, tripId)))
      .limit(1);

    if (participant === undefined) return c.json({ error: "participant not found" }, 404);
    if (participant.userId !== null) {
      return c.json({ error: "that seat is already claimed" }, 409);
    }

    const { token, tokenHash, expiresAt } = issueToken();

    const [invite] = await getDb()
      .insert(tripInvites)
      .values({
        tripId,
        participantId,
        tokenHash,
        expiresAt,
        createdByUserId: c.get("userId"),
      })
      .returning({ id: tripInvites.id, expiresAt: tripInvites.expiresAt });

    // Absolute URL built from configuration, not from X-Forwarded-Proto:
    // cloudflared forwards plain HTTP, so the header says http on a request
    // that arrived over TLS.
    const url = `${publicScheme()}://${c.req.header("host") ?? ""}/invite/${token}`;

    return c.json({ ...invite, url, token }, 201);
  });
