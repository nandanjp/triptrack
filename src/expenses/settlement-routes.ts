import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { jsonBody } from "../http/validate.ts";
import { z } from "zod";
import { requireSession, type AuthenticatedEnv } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import { expenseShares, expenses, settlements, tripParticipants, trips } from "../db/schema.ts";
import { membershipFor, settledAtFor, tripIsSettled, tripNotFound } from "../trips/authorize.ts";
import { simplifyDebts, type Balance } from "./settle.ts";

const newSettlement = z
  .object({
    fromParticipantId: z.string().uuid(),
    toParticipantId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/, "expected a three-letter currency code")
      .transform((v) => v.toUpperCase()),
    settledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").optional(),
  })
  .refine((v) => v.fromParticipantId !== v.toParticipantId, {
    message: "a payment needs two different people",
    path: ["toParticipantId"],
  });

/** Per-participant, per-currency net position, derived from scratch. */
async function balancesFor(tripId: string): Promise<Map<string, Balance[]>> {
  const [paid, owed, sent, received] = await Promise.all([
    // Private spend is excluded: it has no shares, so counting it would make
    // its payer a creditor of nobody.
    getDb()
      .select({
        participantId: expenses.paidByParticipantId,
        currency: expenses.currency,
        amount: sql<string>`sum(${expenses.amountMinor})`,
      })
      .from(expenses)
      .where(and(eq(expenses.tripId, tripId), eq(expenses.isPrivate, false)))
      .groupBy(expenses.paidByParticipantId, expenses.currency),

    getDb()
      .select({
        participantId: expenseShares.participantId,
        currency: expenses.currency,
        amount: sql<string>`sum(${expenseShares.amountMinor})`,
      })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(and(eq(expenses.tripId, tripId), eq(expenses.isPrivate, false)))
      .groupBy(expenseShares.participantId, expenses.currency),

    getDb()
      .select({
        participantId: settlements.fromParticipantId,
        currency: settlements.currency,
        amount: sql<string>`sum(${settlements.amountMinor})`,
      })
      .from(settlements)
      .where(eq(settlements.tripId, tripId))
      .groupBy(settlements.fromParticipantId, settlements.currency),

    getDb()
      .select({
        participantId: settlements.toParticipantId,
        currency: settlements.currency,
        amount: sql<string>`sum(${settlements.amountMinor})`,
      })
      .from(settlements)
      .where(eq(settlements.tripId, tripId))
      .groupBy(settlements.toParticipantId, settlements.currency),
  ]);

  // net = paid − owed + paid-out settlements − received settlements, so that
  // paying a debt moves the payer's negative balance toward zero.
  const net = new Map<string, Map<string, number>>();
  const add = (currency: string, participantId: string, delta: number) => {
    const forCurrency = net.get(currency) ?? new Map<string, number>();
    forCurrency.set(participantId, (forCurrency.get(participantId) ?? 0) + delta);
    net.set(currency, forCurrency);
  };

  for (const row of paid) add(row.currency, row.participantId, Number(row.amount ?? 0));
  for (const row of owed) add(row.currency, row.participantId, -Number(row.amount ?? 0));
  for (const row of sent) add(row.currency, row.participantId, Number(row.amount ?? 0));
  for (const row of received) add(row.currency, row.participantId, -Number(row.amount ?? 0));

  const result = new Map<string, Balance[]>();
  for (const [currency, forCurrency] of net) {
    result.set(
      currency,
      [...forCurrency.entries()].map(([participantId, netMinor]) => ({ participantId, netMinor })),
    );
  }
  return result;
}

export const settlementRoutes = new Hono<AuthenticatedEnv>()
  .use("*", requireSession())

  .get("/:tripId/settlement", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);

    const [byCurrency, recorded, names, settledAt] = await Promise.all([
      balancesFor(tripId),
      getDb()
        .select()
        .from(settlements)
        .where(eq(settlements.tripId, tripId))
        .orderBy(asc(settlements.settledOn)),
      getDb()
        .select({ id: tripParticipants.id, displayName: tripParticipants.displayName })
        .from(tripParticipants)
        .where(eq(tripParticipants.tripId, tripId)),
      settledAtFor(tripId),
    ]);

    const currencies = [...byCurrency.keys()].sort();

    const perCurrency = currencies.map((currency) => {
      const balances = (byCurrency.get(currency) ?? []).filter((b) => b.netMinor !== 0);
      const plan = simplifyDebts(byCurrency.get(currency) ?? []);

      return {
        currency,
        balances: balances.sort((a, b) => b.netMinor - a.netMinor),
        /**
         * A plan is absent only if the balances failed to sum to zero, which
         * means something upstream is wrong. Surfaced rather than hidden.
         */
        plan: plan.ok ? plan.transfers : [],
        inconsistency: plan.ok ? null : plan.error,
      };
    });

    return c.json({
      settledAt,
      outstanding: perCurrency.some((p) => p.balances.length > 0),
      participants: names,
      perCurrency,
      recorded,
    });
  })

  .post("/:tripId/settlements", jsonBody(newSettlement), async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if ((await settledAtFor(tripId)) !== null) return tripIsSettled(c);

    const input = c.req.valid("json");

    const onTrip = new Set(
      (
        await getDb()
          .select({ id: tripParticipants.id })
          .from(tripParticipants)
          .where(eq(tripParticipants.tripId, tripId))
      ).map((p) => p.id),
    );

    if (!onTrip.has(input.fromParticipantId) || !onTrip.has(input.toParticipantId)) {
      return c.json({ error: "both people must be on this trip" }, 400);
    }

    const [created] = await getDb()
      .insert(settlements)
      .values({
        tripId,
        fromParticipantId: input.fromParticipantId,
        toParticipantId: input.toParticipantId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        // Today in the recorder's own terms; a payment is a local-date fact.
        settledOn: input.settledOn ?? new Date().toISOString().slice(0, 10),
        createdByUserId: c.get("userId"),
      })
      .returning();

    return c.json(created, 201);
  })

  .delete("/:tripId/settlements/:settlementId", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if ((await settledAtFor(tripId)) !== null) return tripIsSettled(c);

    const deleted = await getDb()
      .delete(settlements)
      .where(and(eq(settlements.id, c.req.param("settlementId")), eq(settlements.tripId, tripId)))
      .returning({ id: settlements.id });

    return deleted.length === 0 ? c.json({ error: "payment not found" }, 404) : c.body(null, 204);
  })

  /**
   * Declares the money done, which makes the expenses read-only.
   *
   * Refused while anyone is still owed anything: "settled" has to mean
   * something, and writing off a difference is itself a payment worth
   * recording rather than a state to skip past.
   */
  .post("/:tripId/settle", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);
    if ((await settledAtFor(tripId)) !== null) return c.json({ error: "already settled" }, 409);

    const byCurrency = await balancesFor(tripId);
    const outstanding = [...byCurrency.entries()]
      .map(([currency, balances]) => ({ currency, balances: balances.filter((b) => b.netMinor !== 0) }))
      .filter((entry) => entry.balances.length > 0);

    if (outstanding.length > 0) {
      return c.json(
        { error: "someone is still owed; record the remaining payments first", outstanding },
        409,
      );
    }

    const [updated] = await getDb()
      .update(trips)
      .set({ settledAt: new Date() })
      .where(eq(trips.id, tripId))
      .returning({ id: trips.id, settledAt: trips.settledAt });

    return c.json(updated);
  })

  /** The escape hatch for a mistake, since v1 locks rather than versioning. */
  .delete("/:tripId/settle", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);
    if (membership.role !== "owner") return c.json({ error: "owner only" }, 403);

    const [updated] = await getDb()
      .update(trips)
      .set({ settledAt: null })
      .where(eq(trips.id, tripId))
      .returning({ id: trips.id, settledAt: trips.settledAt });

    return c.json(updated);
  });
