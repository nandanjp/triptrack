import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "./helpers.ts";

const hasDb = process.env.DATABASE_URL !== undefined;
const needsDb = hasDb ? {} : { skip: "DATABASE_URL not set" };
process.env.SESSION_SECRET ??= "test-secret-not-used-in-production";

const h = await import("./helpers.ts");
const { app, authed } = h;

after(async () => {
  if (!hasDb) return;
  const { closeDb } = await import("../src/db/client.ts");
  await closeDb();
});

const send = (cookie: string, method: string, path: string, body?: unknown) =>
  app().request(path, authed(cookie, method, body));

async function created<T>(res: Response): Promise<T> {
  assert.equal(res.status, 201, `setup failed: ${res.status} ${await res.clone().text()}`);
  return (await res.json()) as T;
}
const body = async <T>(res: Response): Promise<T> => (await res.json()) as T;

type Seat = { id: string; displayName: string; role: string };

/** A trip with the owner plus two unclaimed seats, which is what splits need. */
async function tripWithSeats(session: Session) {
  const tripId = await h.createTrip(session, "Korea");
  const extra: Seat[] = [];
  for (const displayName of ["Sister", "Friend"]) {
    extra.push(await created<Seat>(await send(session.cookie, "POST", `/api/trips/${tripId}/participants`, { displayName })));
  }
  const detail = await body<{ participants: Seat[] }>(await send(session.cookie, "GET", `/api/trips/${tripId}`));
  const owner = detail.participants.find((p) => p.role === "owner");
  assert.ok(owner);
  return { tripId, owner, sister: extra[0]!, friend: extra[1]! };
}

const shareFor = (shares: { participantId: string; amountMinor: number }[], id: string): number =>
  shares.find((s) => s.participantId === id)?.amountMinor ?? 0;

test("an equal split records shares that sum to the total", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, owner, sister, friend } = await tripWithSeats(me);

  const expense = await created<{ shares: { participantId: string; amountMinor: number }[] }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
      description: "Dinner",
      amountMinor: 40_000,
      currency: "KRW",
    }),
  );

  assert.equal(expense.shares.reduce((n, s) => n + s.amountMinor, 0), 40_000);
  assert.equal(shareFor(expense.shares, owner.id), 13_334, "the payer absorbs the rounding");
  assert.equal(shareFor(expense.shares, sister.id), 13_333);
  assert.equal(shareFor(expense.shares, friend.id), 13_333);
});

test("the worked example: an exact split leaves the payer owing nothing", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, owner, sister, friend } = await tripWithSeats(me);

  const expense = await created<{ shares: { participantId: string; amountMinor: number }[] }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
      description: "Dinner",
      amountMinor: 10_000,
      currency: "KRW",
      splitMode: "exact",
      exactShares: [
        { participantId: sister.id, amountMinor: 4_000 },
        { participantId: friend.id, amountMinor: 6_000 },
      ],
    }),
  );

  assert.equal(shareFor(expense.shares, owner.id), 0, "covered by the others");
  assert.equal(expense.shares.length, 2, "a zero share is not stored");
});

test("paid is not owed: the payer is owed what the others consumed", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, owner, sister, friend } = await tripWithSeats(me);

  await created(
    await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
      description: "Dinner for four",
      amountMinor: 40_000,
      currency: "KRW",
    }),
  );

  const summary = await body<{ shared: { currency: string; totalMinor: number }[]; mine: { totalMinor: number }[] }>(
    await send(me.cookie, "GET", `/api/trips/${tripId}/expenses/summary`),
  );

  assert.deepEqual(summary.shared, [{ currency: "KRW", totalMinor: 40_000 }], "the group spent the full amount");
  assert.equal(summary.mine[0]?.totalMinor, 13_334, "but my share of it is a third");
});

test("totals group by currency rather than converting", needsDb, async () => {
  const me = await h.signUp();
  const { tripId } = await tripWithSeats(me);

  // A Korea trip: flights bought at home, everything else on the ground.
  await created(await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Flights", amountMinor: 185_000, currency: "CAD" }));
  await created(await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Dinner", amountMinor: 40_000, currency: "krw" }));

  const summary = await body<{ shared: { currency: string; totalMinor: number }[] }>(
    await send(me.cookie, "GET", `/api/trips/${tripId}/expenses/summary`),
  );

  assert.deepEqual(summary.shared, [
    { currency: "CAD", totalMinor: 185_000 },
    { currency: "KRW", totalMinor: 40_000 },
  ], "two numbers, never one converted one");
});

test("private spend is invisible to the group and absent from the shared total", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const { tripId, sister } = await tripWithSeats(owner);

  const { token } = await body<{ token: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants/${sister.id}/invite`),
  );
  await send(member.cookie, "POST", `/api/invites/${token}/accept`);

  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Group dinner", amountMinor: 30_000, currency: "KRW" }));
  const secret = await created<{ id: string; shares: unknown[] }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, {
      description: "A present for them",
      amountMinor: 50_000,
      currency: "KRW",
      isPrivate: true,
    }),
  );

  assert.deepEqual(secret.shares, [], "a private expense has no one to split with");

  const asMember = await body<{ description: string }[]>(await send(member.cookie, "GET", `/api/trips/${tripId}/expenses`));
  assert.deepEqual(asMember.map((e) => e.description), ["Group dinner"], "the present is not listed");

  const asOwner = await body<{ description: string }[]>(await send(owner.cookie, "GET", `/api/trips/${tripId}/expenses`));
  assert.equal(asOwner.length, 2, "the payer still sees their own");

  const groupSummary = await body<{ shared: { totalMinor: number }[] }>(
    await send(member.cookie, "GET", `/api/trips/${tripId}/expenses/summary`),
  );
  assert.equal(groupSummary.shared[0]?.totalMinor, 30_000, "private spend is outside the shared total");

  const mySummary = await body<{ shared: { totalMinor: number }[]; mine: { totalMinor: number }[] }>(
    await send(owner.cookie, "GET", `/api/trips/${tripId}/expenses/summary`),
  );
  assert.equal(mySummary.shared[0]?.totalMinor, 30_000);
  assert.equal(mySummary.mine[0]?.totalMinor, 10_000 + 50_000, "my third of dinner, plus all of the present");
});

test("someone else's private expense cannot be deleted, because it is not visible", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const { tripId, sister } = await tripWithSeats(owner);
  const { token } = await body<{ token: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants/${sister.id}/invite`),
  );
  await send(member.cookie, "POST", `/api/invites/${token}/accept`);

  const secret = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Private", amountMinor: 1_000, currency: "KRW", isPrivate: true }),
  );

  assert.equal((await send(member.cookie, "DELETE", `/api/trips/${tripId}/expenses/${secret.id}`)).status, 404);
  assert.equal((await send(owner.cookie, "DELETE", `/api/trips/${tripId}/expenses/${secret.id}`)).status, 204);
});

test("an expense on an entry is split among whoever was there", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, owner, sister } = await tripWithSeats(me);

  const day = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/days`, { date: "2027-04-01" }));
  // The group split up: only two of the three went to Kyoto.
  const entry = await created<{ id: string }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/days/${day.id}/entries`, {
      kind: "activity",
      title: "Kyoto day trip",
      attendeeIds: [owner.id, sister.id],
    }),
  );

  const expense = await created<{ shares: { participantId: string; amountMinor: number }[] }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
      description: "Train tickets",
      amountMinor: 9_000,
      currency: "KRW",
      entryId: entry.id,
    }),
  );

  assert.equal(expense.shares.length, 2, "the person who stayed behind owes nothing");
  assert.equal(shareFor(expense.shares, owner.id), 4_500);
  assert.equal(shareFor(expense.shares, sister.id), 4_500);
});

test("a refund is a negative expense against its booking", needsDb, async () => {
  const me = await h.signUp();
  const { tripId } = await tripWithSeats(me);
  const booking = await created<{ id: string }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, {
      kind: "lodging",
      title: "Cancelled hotel",
      startsAt: "2027-04-01T15:00:00Z",
    }),
  );

  await created(await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Hotel", amountMinor: 300_000, currency: "KRW", bookingId: booking.id }));
  await created(await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Refund, less fee", amountMinor: -250_000, currency: "KRW", bookingId: booking.id }));

  const summary = await body<{ shared: { totalMinor: number }[] }>(
    await send(me.cookie, "GET", `/api/trips/${tripId}/expenses/summary`),
  );
  assert.equal(summary.shared[0]?.totalMinor, 50_000, "the cancellation fee is what it actually cost");
});

test("an expense belongs to at most one parent, and that parent must be on the trip", needsDb, async () => {
  const me = await h.signUp();
  const { tripId } = await tripWithSeats(me);
  const day = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/days`, { date: "2027-04-01" }));
  const booking = await created<{ id: string }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, { kind: "transit", title: "Flight", startsAt: "2027-04-01T01:00:00Z" }),
  );

  const two = await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
    description: "Confused", amountMinor: 100, currency: "KRW", dayId: day.id, bookingId: booking.id,
  });
  assert.equal(two.status, 400);

  // A parent from another trip must not pull the expense out of this one.
  const otherTrip = await h.createTrip(me, "Elsewhere");
  const foreignDay = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${otherTrip}/days`, { date: "2027-05-01" }));
  const foreign = await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
    description: "Escapee", amountMinor: 100, currency: "KRW", dayId: foreignDay.id,
  });
  assert.equal(foreign.status, 400);
});

test("the database refuses two parents even if a handler ever forgets", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, owner } = await tripWithSeats(me);
  const day = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/days`, { date: "2027-04-01" }));
  const booking = await created<{ id: string }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, { kind: "transit", title: "Flight", startsAt: "2027-04-01T01:00:00Z" }),
  );

  const { getDb } = await import("../src/db/client.ts");
  const { expenses } = await import("../src/db/schema.ts");

  // Straight past the handlers: these invariants are in the schema, not just
  // in code, so they hold against a direct write too.
  await h.assertRefusedBy("expenses_single_parent", () =>
    getDb().insert(expenses).values({
      tripId, description: "Bypass", amountMinor: 100, currency: "KRW",
      paidByParticipantId: owner.id, dayId: day.id, bookingId: booking.id,
    }),
  );

  await h.assertRefusedBy("expenses_amount_nonzero", () =>
    getDb().insert(expenses).values({
      tripId, description: "Zero", amountMinor: 0, currency: "KRW", paidByParticipantId: owner.id,
    }),
  );

  await h.assertRefusedBy("expenses_currency_format", () =>
    getDb().insert(expenses).values({
      tripId, description: "Bad currency", amountMinor: 100, currency: "won", paidByParticipantId: owner.id,
    }),
  );
});

test("editing a description leaves everyone's money alone", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, owner } = await tripWithSeats(me);
  const expense = await created<{ id: string; shares: { participantId: string; amountMinor: number }[] }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Dinner", amountMinor: 40_000, currency: "KRW" }),
  );

  const patched = await send(me.cookie, "PATCH", `/api/trips/${tripId}/expenses/${expense.id}`, { description: "Dinner at the market" });
  assert.equal(patched.status, 200);

  const after = await body<{ shares: { participantId: string; amountMinor: number }[] }>(patched);
  assert.equal(shareFor(after.shares, owner.id), 13_334, "untouched");
  assert.equal(after.shares.length, 3);
});

test("changing an amount demands the split intent, because it cannot be inferred", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, owner, sister, friend } = await tripWithSeats(me);
  const expense = await created<{ id: string }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Dinner", amountMinor: 40_000, currency: "KRW" }),
  );

  // A stored zero share is indistinguishable from never having been in the
  // split, so re-deriving it would risk moving money silently.
  const guessed = await send(me.cookie, "PATCH", `/api/trips/${tripId}/expenses/${expense.id}`, { amountMinor: 60_000 });
  assert.equal(guessed.status, 400);
  assert.match((await body<{ error: string }>(guessed)).error, /cannot be inferred/);

  const stated = await send(me.cookie, "PATCH", `/api/trips/${tripId}/expenses/${expense.id}`, {
    amountMinor: 60_000,
    consumerIds: [owner.id, sister.id, friend.id],
  });
  assert.equal(stated.status, 200);
  const after = await body<{ shares: { amountMinor: number }[] }>(stated);
  assert.equal(after.shares.reduce((n, s) => n + s.amountMinor, 0), 60_000);
});

test("the payer must be on the trip", needsDb, async () => {
  const me = await h.signUp();
  const { tripId } = await tripWithSeats(me);
  const otherTrip = await h.createTrip(me, "Elsewhere");
  const foreignSeat = await created<{ id: string }>(
    await send(me.cookie, "POST", `/api/trips/${otherTrip}/participants`, { displayName: "Outsider" }),
  );

  const res = await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
    description: "Nope", amountMinor: 100, currency: "KRW", paidByParticipantId: foreignSeat.id,
  });
  assert.equal(res.status, 400);
});

test("expenses are invisible to someone not on the trip", needsDb, async () => {
  const me = await h.signUp();
  const stranger = await h.signUp();
  const { tripId } = await tripWithSeats(me);

  for (const path of [`/api/trips/${tripId}/expenses`, `/api/trips/${tripId}/expenses/summary`]) {
    assert.equal((await send(stranger.cookie, "GET", path)).status, 404, path);
  }
});

test("validation failures answer in the normal error shape, not a Zod dump", needsDb, async () => {
  const me = await h.signUp();
  const { tripId } = await tripWithSeats(me);

  // The client looks for `error`; Zod's own serialised issue list would show
  // up as "request failed (400)" and hide the actual reason.
  const res = await send(me.cookie, "POST", `/api/trips/${tripId}/expenses`, {
    description: "",
    amountMinor: 100,
    currency: "KRW",
  });

  assert.equal(res.status, 400);
  const payload = await body<Record<string, unknown>>(res);
  assert.equal(typeof payload.error, "string", `expected {error}, got ${JSON.stringify(payload)}`);
  assert.ok(!("issues" in payload), "no raw Zod issue list");
  assert.match(String(payload.error), /description/);
});
