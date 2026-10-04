import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { jsonBody } from "../http/validate.ts";
import { z } from "zod";
import { requireSession, type AuthenticatedEnv } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import {
  bookings,
  dayEntries,
  dayEntryAttendees,
  expenseShares,
  expenses,
  tripDays,
  tripParticipants,
} from "../db/schema.ts";
import { membershipFor, settledAtFor, tripIsSettled, tripNotFound } from "../trips/authorize.ts";
import { SPLIT_MODES, splitExpense, type Share } from "./split.ts";

const money = z.number().int();

const shareInput = z.object({
  participantId: z.string().uuid(),
  amountMinor: money,
});

const expenseFields = {
  description: z.string().trim().min(1).max(300),
  /** Minor units: the client converts, using the exponent for the currency. */
  amountMinor: money.refine((n) => n !== 0, "amount cannot be zero"),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, "expected a three-letter currency code")
    .transform((v) => v.toUpperCase()),
  /** Defaults to the caller's own seat. */
  paidByParticipantId: z.string().uuid().optional(),
  dayId: z.string().uuid().nullish(),
  bookingId: z.string().uuid().nullish(),
  entryId: z.string().uuid().nullish(),
  splitMode: z.enum(SPLIT_MODES).optional(),
  /** Who consumed it. Defaults to the entry's attendees, else everyone. */
  consumerIds: z.array(z.string().uuid()).optional(),
  /** `exact` only: what each named non-payer owes. */
  exactShares: z.array(shareInput).optional(),
  isPrivate: z.boolean().optional(),
};

const parentCount = (v: { dayId?: unknown; bookingId?: unknown; entryId?: unknown }): number =>
  [v.dayId, v.bookingId, v.entryId].filter((x) => x != null).length;

const singleParent = <T extends { dayId?: unknown; bookingId?: unknown; entryId?: unknown }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  if (parentCount(value) > 1) {
    ctx.addIssue({
      code: "custom",
      message: "an expense belongs to at most one of a day, a booking or an entry",
    });
  }
};

const newExpense = z.object(expenseFields).superRefine(singleParent);
const patchExpense = z.object(expenseFields).partial().superRefine(singleParent);

/** Sums rows that share a day and a currency, since they come from two queries. */
function mergePerDay(
  rows: { dayId: string | null; currency: string; totalMinor: number | string | null }[],
): { dayId: string; currency: string; totalMinor: number }[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (row.dayId === null) continue;
    const key = `${row.dayId}|${row.currency}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(row.totalMinor ?? 0));
  }

  return [...totals.entries()]
    .filter(([, totalMinor]) => totalMinor !== 0)
    .map(([key, totalMinor]) => {
      const [dayId = "", currency = ""] = key.split("|");
      return { dayId, currency, totalMinor };
    });
}

/** Groups a flat result into one total per currency. */
const byCurrency = (rows: { currency: string; totalMinor: number | string | null }[]) =>
  rows
    .map((r) => ({ currency: r.currency, totalMinor: Number(r.totalMinor ?? 0) }))
    .filter((r) => r.totalMinor !== 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));

export const expenseRoutes = new Hono<AuthenticatedEnv>()
  .use("*", requireSession())

  /**
   * Totals grouped by currency rather than converted (D12). A Korea trip has
   * flights in CAD and everything on the ground in KRW, and converting would
   * make the trip total drift as rates move.
   */
  .get("/:tripId/expenses/summary", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);

    const me = membership.participantId;

    const [shared, myShares, myPrivate, perDay, mySharesPerDay, myPrivatePerDay] = await Promise.all([
      getDb()
        .select({ currency: expenses.currency, totalMinor: sql<string>`sum(${expenses.amountMinor})` })
        .from(expenses)
        .where(and(eq(expenses.tripId, tripId), eq(expenses.isPrivate, false)))
        .groupBy(expenses.currency),

      // What I owe of the shared expenses.
      getDb()
        .select({ currency: expenses.currency, totalMinor: sql<string>`sum(${expenseShares.amountMinor})` })
        .from(expenseShares)
        .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
        .where(
          and(
            eq(expenses.tripId, tripId),
            eq(expenses.isPrivate, false),
            eq(expenseShares.participantId, me),
          ),
        )
        .groupBy(expenses.currency),

      // Plus my own private spend, which no one else sees.
      getDb()
        .select({ currency: expenses.currency, totalMinor: sql<string>`sum(${expenses.amountMinor})` })
        .from(expenses)
        .where(
          and(
            eq(expenses.tripId, tripId),
            eq(expenses.isPrivate, true),
            eq(expenses.paidByParticipantId, me),
          ),
        )
        .groupBy(expenses.currency),

      getDb()
        .select({
          dayId: expenses.dayId,
          currency: expenses.currency,
          totalMinor: sql<string>`sum(${expenses.amountMinor})`,
        })
        .from(expenses)
        .where(
          and(eq(expenses.tripId, tripId), eq(expenses.isPrivate, false), sql`${expenses.dayId} is not null`),
        )
        .groupBy(expenses.dayId, expenses.currency),

      /**
       * My daily spend: my share of the group's, plus my own private spend.
       * Reported alongside the shared figure rather than instead of it —
       * "the group spent this today" and "this day cost me that" are both
       * real questions and neither substitutes for the other.
       */
      getDb()
        .select({
          dayId: expenses.dayId,
          currency: expenses.currency,
          totalMinor: sql<string>`sum(${expenseShares.amountMinor})`,
        })
        .from(expenseShares)
        .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
        .where(
          and(
            eq(expenses.tripId, tripId),
            eq(expenses.isPrivate, false),
            eq(expenseShares.participantId, me),
            sql`${expenses.dayId} is not null`,
          ),
        )
        .groupBy(expenses.dayId, expenses.currency),

      getDb()
        .select({
          dayId: expenses.dayId,
          currency: expenses.currency,
          totalMinor: sql<string>`sum(${expenses.amountMinor})`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.tripId, tripId),
            eq(expenses.isPrivate, true),
            eq(expenses.paidByParticipantId, me),
            sql`${expenses.dayId} is not null`,
          ),
        )
        .groupBy(expenses.dayId, expenses.currency),
    ]);

    // My total is my share of the group's spending plus my private spending.
    const mine = new Map<string, number>();
    for (const row of [...myShares, ...myPrivate]) {
      mine.set(row.currency, (mine.get(row.currency) ?? 0) + Number(row.totalMinor ?? 0));
    }

    return c.json({
      /** Everything the group can see. Private spend is excluded by design. */
      shared: byCurrency(shared),
      mine: byCurrency([...mine.entries()].map(([currency, totalMinor]) => ({ currency, totalMinor }))),
      perDay: perDay
        .filter((r) => r.dayId !== null)
        .map((r) => ({ dayId: r.dayId, currency: r.currency, totalMinor: Number(r.totalMinor ?? 0) })),
      minePerDay: mergePerDay([...mySharesPerDay, ...myPrivatePerDay]),
    });
  })

  .get("/:tripId/expenses", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);

    const me = membership.participantId;

    const rows = await getDb()
      .select({
        id: expenses.id,
        description: expenses.description,
        amountMinor: expenses.amountMinor,
        currency: expenses.currency,
        paidByParticipantId: expenses.paidByParticipantId,
        paidByName: tripParticipants.displayName,
        splitMode: expenses.splitMode,
        isPrivate: expenses.isPrivate,
        dayId: expenses.dayId,
        bookingId: expenses.bookingId,
        entryId: expenses.entryId,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .innerJoin(tripParticipants, eq(tripParticipants.id, expenses.paidByParticipantId))
      .where(
        and(
          eq(expenses.tripId, tripId),
          // Private spend is the payer's business alone.
          or(eq(expenses.isPrivate, false), eq(expenses.paidByParticipantId, me)),
        ),
      )
      .orderBy(desc(expenses.createdAt));

    if (rows.length === 0) return c.json([]);

    const shares = await getDb()
      .select({
        expenseId: expenseShares.expenseId,
        participantId: expenseShares.participantId,
        amountMinor: expenseShares.amountMinor,
        displayName: tripParticipants.displayName,
      })
      .from(expenseShares)
      .innerJoin(tripParticipants, eq(tripParticipants.id, expenseShares.participantId))
      .where(inArray(expenseShares.expenseId, rows.map((r) => r.id)))
      .orderBy(asc(tripParticipants.displayName));

    return c.json(
      rows.map((row) => ({
        ...row,
        shares: shares.filter((s) => s.expenseId === row.id).map(({ expenseId, ...rest }) => rest),
      })),
    );
  })

  .post("/:tripId/expenses", jsonBody(newExpense), async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);

    // A settled trip's expenses are read-only (D14): editing one would
    // corrupt a balance someone has already paid against.
    if ((await settledAtFor(tripId)) !== null) return tripIsSettled(c);

    const input = c.req.valid("json");
    const payerId = input.paidByParticipantId ?? membership.participantId;

    const participants = await getDb()
      .select({ id: tripParticipants.id })
      .from(tripParticipants)
      .where(eq(tripParticipants.tripId, tripId));

    const onTrip = new Set(participants.map((p) => p.id));
    if (!onTrip.has(payerId)) return c.json({ error: "the payer is not on this trip" }, 400);

    const parentError = await validateParent(input, tripId);
    if (parentError !== undefined) return c.json({ error: parentError }, 400);

    const isPrivate = input.isPrivate ?? false;

    // A private expense carries no shares: there is no one to split it with.
    let shares: Share[] = [];
    if (!isPrivate) {
      const consumerIds = input.consumerIds ?? (await defaultConsumers(input.entryId ?? null, tripId));

      if (consumerIds.some((id) => !onTrip.has(id))) {
        return c.json({ error: "one or more people are not on this trip" }, 400);
      }
      if ((input.exactShares ?? []).some((s) => !onTrip.has(s.participantId))) {
        return c.json({ error: "one or more people are not on this trip" }, 400);
      }

      const result = splitExpense({
        totalMinor: input.amountMinor,
        payerId,
        mode: input.splitMode ?? "equal",
        consumerIds,
        exactShares: input.exactShares,
      });

      if (!result.ok) return c.json({ error: result.error }, 400);
      shares = result.shares;
    }

    const expense = await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(expenses)
        .values({
          tripId,
          description: input.description,
          amountMinor: input.amountMinor,
          currency: input.currency,
          paidByParticipantId: payerId,
          dayId: input.dayId ?? null,
          bookingId: input.bookingId ?? null,
          entryId: input.entryId ?? null,
          isPrivate,
          ...(input.splitMode === undefined ? {} : { splitMode: input.splitMode }),
        })
        .returning();

      if (created === undefined) throw new Error("expense insert returned no row");

      if (shares.length > 0) {
        await tx
          .insert(expenseShares)
          .values(shares.map((s) => ({ expenseId: created.id, ...s })));
      }

      return created;
    });

    return c.json({ ...expense, shares }, 201);
  })

  /**
   * Editing recomputes the shares from scratch rather than adjusting them.
   * Splitting is cheap and deterministic, so deriving once from the new state
   * is safer than reconciling two sets of numbers.
   *
   * Step 7 adds the rule that a settled expense is immutable (ADR D14); until
   * settlement exists there is nothing to protect.
   */
  .patch("/:tripId/expenses/:expenseId", jsonBody(patchExpense), async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);

    if ((await settledAtFor(tripId)) !== null) return tripIsSettled(c);

    const expenseId = c.req.param("expenseId");
    const [existing] = await getDb()
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.tripId, tripId)))
      .limit(1);

    if (existing === undefined) return c.json({ error: "expense not found" }, 404);
    if (existing.isPrivate && existing.paidByParticipantId !== membership.participantId) {
      return c.json({ error: "expense not found" }, 404);
    }

    const input = c.req.valid("json");
    if (Object.keys(input).length === 0) return c.json({ error: "nothing to update" }, 400);

    // A patch may set one parent while another is already stored, so the
    // single-parent rule is checked against the merged state, not the input.
    const merged = {
      dayId: input.dayId === undefined ? existing.dayId : input.dayId,
      bookingId: input.bookingId === undefined ? existing.bookingId : input.bookingId,
      entryId: input.entryId === undefined ? existing.entryId : input.entryId,
    };
    if (parentCount(merged) > 1) {
      return c.json({ error: "an expense belongs to at most one of a day, a booking or an entry" }, 400);
    }

    const parentError = await validateParent(merged, tripId);
    if (parentError !== undefined) return c.json({ error: parentError }, 400);

    const payerId = input.paidByParticipantId ?? existing.paidByParticipantId;
    const amountMinor = input.amountMinor ?? existing.amountMinor;
    const splitMode = input.splitMode ?? existing.splitMode;
    const isPrivate = input.isPrivate ?? existing.isPrivate;

    const participants = await getDb()
      .select({ id: tripParticipants.id })
      .from(tripParticipants)
      .where(eq(tripParticipants.tripId, tripId));
    const onTrip = new Set(participants.map((p) => p.id));

    if (!onTrip.has(payerId)) return c.json({ error: "the payer is not on this trip" }, 400);

    /**
     * Whether the shares have to be recomputed. Fixing a typo in a
     * description must not touch anybody's money.
     */
    const affectsSplit =
      input.amountMinor !== undefined ||
      input.paidByParticipantId !== undefined ||
      input.splitMode !== undefined ||
      input.consumerIds !== undefined ||
      input.exactShares !== undefined ||
      input.isPrivate !== undefined;

    let shares: Share[] | undefined;

    if (affectsSplit && !isPrivate) {
      /**
       * The caller has to restate the split intent, because the stored shares
       * cannot reconstruct it: a zero share is not stored, so a payer who owes
       * nothing is indistinguishable from a payer who was never in the split.
       * Guessing would silently move money — paying for someone else's taxi
       * and splitting a dinner with them look identical afterwards.
       */
      if (splitMode === "equal" && input.consumerIds === undefined) {
        return c.json({ error: "changing the split needs consumerIds, which cannot be inferred" }, 400);
      }
      if (splitMode === "exact" && input.exactShares === undefined) {
        return c.json({ error: "changing the split needs exactShares, which cannot be inferred" }, 400);
      }

      const consumerIds = input.consumerIds ?? [];

      if (consumerIds.some((id) => !onTrip.has(id))) {
        return c.json({ error: "one or more people are not on this trip" }, 400);
      }
      if ((input.exactShares ?? []).some((s) => !onTrip.has(s.participantId))) {
        return c.json({ error: "one or more people are not on this trip" }, 400);
      }

      const result = splitExpense({
        totalMinor: amountMinor,
        payerId,
        mode: splitMode,
        consumerIds,
        exactShares: input.exactShares,
      });

      if (!result.ok) return c.json({ error: result.error }, 400);
      shares = result.shares;
    } else if (affectsSplit && isPrivate) {
      // Becoming private removes the shares: there is no one to split with.
      shares = [];
    }

    const updated = await getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(expenses)
        .set({
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.amountMinor === undefined ? {} : { amountMinor }),
          ...(input.currency === undefined ? {} : { currency: input.currency }),
          ...(input.paidByParticipantId === undefined ? {} : { paidByParticipantId: payerId }),
          ...(input.splitMode === undefined ? {} : { splitMode }),
          ...(input.isPrivate === undefined ? {} : { isPrivate }),
          dayId: merged.dayId,
          bookingId: merged.bookingId,
          entryId: merged.entryId,
        })
        .where(eq(expenses.id, expenseId))
        .returning();

      // Left untouched when nothing affecting the split changed.
      if (shares !== undefined) {
        await tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
        if (shares.length > 0) {
          await tx.insert(expenseShares).values(shares.map((s) => ({ expenseId, ...s })));
        }
      }

      return row;
    });

    return c.json({ ...updated, shares: shares ?? (await sharesOf(expenseId)) });
  })

  .delete("/:tripId/expenses/:expenseId", async (c) => {
    const tripId = c.req.param("tripId");
    const membership = await membershipFor(tripId, c.get("userId"));
    if (membership === undefined) return tripNotFound(c);

    if ((await settledAtFor(tripId)) !== null) return tripIsSettled(c);

    const [existing] = await getDb()
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, c.req.param("expenseId")), eq(expenses.tripId, tripId)))
      .limit(1);

    if (existing === undefined) return c.json({ error: "expense not found" }, 404);
    // Someone else's private spend is not visible, so it is not deletable.
    if (existing.isPrivate && existing.paidByParticipantId !== membership.participantId) {
      return c.json({ error: "expense not found" }, 404);
    }

    // Shares cascade.
    await getDb().delete(expenses).where(eq(expenses.id, existing.id));
    return c.body(null, 204);
  });

/** The stored shares, for echoing back a patch that did not recompute them. */
async function sharesOf(expenseId: string): Promise<Share[]> {
  return getDb()
    .select({ participantId: expenseShares.participantId, amountMinor: expenseShares.amountMinor })
    .from(expenseShares)
    .where(eq(expenseShares.expenseId, expenseId));
}

/** A parent must exist and belong to this trip, or the expense escapes it. */
async function validateParent(
  input: { dayId?: string | null; bookingId?: string | null; entryId?: string | null },
  tripId: string,
): Promise<string | undefined> {
  if (input.dayId != null) {
    const [row] = await getDb()
      .select({ id: tripDays.id })
      .from(tripDays)
      .where(and(eq(tripDays.id, input.dayId), eq(tripDays.tripId, tripId)))
      .limit(1);
    if (row === undefined) return "that day is not on this trip";
  }

  if (input.bookingId != null) {
    const [row] = await getDb()
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.tripId, tripId)))
      .limit(1);
    if (row === undefined) return "that booking is not on this trip";
  }

  if (input.entryId != null) {
    const [row] = await getDb()
      .select({ id: dayEntries.id })
      .from(dayEntries)
      .innerJoin(tripDays, eq(tripDays.id, dayEntries.dayId))
      .where(and(eq(dayEntries.id, input.entryId), eq(tripDays.tripId, tripId)))
      .limit(1);
    if (row === undefined) return "that entry is not on this trip";
  }

  return undefined;
}

/**
 * An expense on an entry is split among whoever was there; otherwise among
 * everyone currently on the trip. Using the entry's attendance is what makes
 * "the group split up that day" fall out correctly.
 */
async function defaultConsumers(entryId: string | null, tripId: string): Promise<string[]> {
  if (entryId !== null) {
    const attendees = await getDb()
      .select({ id: dayEntryAttendees.participantId })
      .from(dayEntryAttendees)
      .where(eq(dayEntryAttendees.entryId, entryId));

    if (attendees.length > 0) return attendees.map((a) => a.id);
  }

  const everyone = await getDb()
    .select({ id: tripParticipants.id })
    .from(tripParticipants)
    .where(eq(tripParticipants.tripId, tripId));

  return everyone.map((p) => p.id);
}
