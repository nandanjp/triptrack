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
type Settlement = {
  settledAt: string | null;
  outstanding: boolean;
  perCurrency: {
    currency: string;
    balances: { participantId: string; netMinor: number }[];
    plan: { fromParticipantId: string; toParticipantId: string; amountMinor: number }[];
    inconsistency: string | null;
  }[];
  recorded: { id: string; amountMinor: number }[];
};

async function tripWithSeats(session: Session) {
  const tripId = await h.createTrip(session, "Korea");
  const extra: Seat[] = [];
  for (const displayName of ["Sister", "Friend"]) {
    extra.push(await created<Seat>(await send(session.cookie, "POST", `/api/trips/${tripId}/participants`, { displayName })));
  }
  const detail = await body<{ myParticipantId: string; participants: Seat[] }>(
    await send(session.cookie, "GET", `/api/trips/${tripId}`),
  );
  return { tripId, me: detail.myParticipantId, sister: extra[0]!, friend: extra[1]! };
}

const settlement = async (cookie: string, tripId: string): Promise<Settlement> =>
  body<Settlement>(await send(cookie, "GET", `/api/trips/${tripId}/settlement`));

const net = (s: Settlement, currency: string, participantId: string): number =>
  s.perCurrency.find((p) => p.currency === currency)?.balances.find((b) => b.participantId === participantId)?.netMinor ?? 0;

test("balances are paid minus owed, and the plan clears them", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId, me, sister, friend } = await tripWithSeats(owner);

  // One payer fronts ₩40,000 for three people.
  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Dinner", amountMinor: 40_000, currency: "KRW" }));

  const s = await settlement(owner.cookie, tripId);

  assert.equal(net(s, "KRW", me), 26_666, "paid 40000, owes a third");
  assert.equal(net(s, "KRW", sister.id), -13_333);
  assert.equal(net(s, "KRW", friend.id), -13_333);
  assert.equal(
    s.perCurrency.find((p) => p.currency === "KRW")?.balances.reduce((n, b) => n + b.netMinor, 0),
    0,
    "balances must sum to zero",
  );

  const plan = s.perCurrency.find((p) => p.currency === "KRW")?.plan ?? [];
  assert.equal(plan.length, 2);
  assert.ok(plan.every((t) => t.toParticipantId === me), "both owe the payer");
  assert.equal(s.perCurrency.find((p) => p.currency === "KRW")?.inconsistency, null);
});

test("recording the plan drives every balance to zero", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await tripWithSeats(owner);
  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Dinner", amountMinor: 40_000, currency: "KRW" }));

  const before = await settlement(owner.cookie, tripId);
  assert.equal(before.outstanding, true);

  for (const transfer of before.perCurrency.flatMap((p) => p.plan.map((t) => ({ ...t, currency: p.currency })))) {
    assert.equal(
      (await send(owner.cookie, "POST", `/api/trips/${tripId}/settlements`, transfer)).status,
      201,
    );
  }

  const after = await settlement(owner.cookie, tripId);
  assert.equal(after.outstanding, false, "nobody is owed anything");
  assert.deepEqual(after.perCurrency.flatMap((p) => p.balances), []);
  assert.deepEqual(after.perCurrency.flatMap((p) => p.plan), [], "nothing left to pay");
});

test("each currency settles independently, never converted", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId, me, sister } = await tripWithSeats(owner);

  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Flights", amountMinor: 180_000, currency: "CAD" }));
  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, {
    description: "Dinner", amountMinor: 30_000, currency: "KRW", paidByParticipantId: sister.id,
  }));

  const s = await settlement(owner.cookie, tripId);
  assert.deepEqual(s.perCurrency.map((p) => p.currency), ["CAD", "KRW"]);

  assert.equal(net(s, "CAD", me), 120_000, "owed two thirds of the flights");
  assert.equal(net(s, "KRW", sister.id), 20_000, "owed two thirds of dinner");
  // A CAD debt cannot be cancelled against a KRW credit.
  assert.ok(s.perCurrency.every((p) => p.plan.length > 0));
});

test("private spend stays out of the balances entirely", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId, me } = await tripWithSeats(owner);

  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Present", amountMinor: 50_000, currency: "KRW", isPrivate: true }));

  const s = await settlement(owner.cookie, tripId);
  assert.equal(net(s, "KRW", me), 0, "private spend makes nobody a creditor");
  assert.equal(s.outstanding, false);
});

test("a trip cannot be settled while anyone is still owed", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await tripWithSeats(owner);
  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Dinner", amountMinor: 40_000, currency: "KRW" }));

  const res = await send(owner.cookie, "POST", `/api/trips/${tripId}/settle`);
  assert.equal(res.status, 409);

  const payload = await body<{ error: string; outstanding: { currency: string }[] }>(res);
  assert.match(payload.error, /still owed/);
  assert.equal(payload.outstanding[0]?.currency, "KRW", "it says what is outstanding");
});

test("settling locks the money, and reopening unlocks it", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await tripWithSeats(owner);
  const expense = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Dinner", amountMinor: 40_000, currency: "KRW" }),
  );

  const before = await settlement(owner.cookie, tripId);
  for (const transfer of before.perCurrency.flatMap((p) => p.plan.map((t) => ({ ...t, currency: p.currency })))) {
    await send(owner.cookie, "POST", `/api/trips/${tripId}/settlements`, transfer);
  }

  const settled = await send(owner.cookie, "POST", `/api/trips/${tripId}/settle`);
  assert.equal(settled.status, 200);
  assert.ok((await body<{ settledAt: string }>(settled)).settledAt);

  // Read-only from here: editing a settled expense would corrupt a balance
  // somebody has already paid against.
  assert.equal((await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Late", amountMinor: 100, currency: "KRW" })).status, 409);
  assert.equal((await send(owner.cookie, "PATCH", `/api/trips/${tripId}/expenses/${expense.id}`, { description: "Nope" })).status, 409);
  assert.equal((await send(owner.cookie, "DELETE", `/api/trips/${tripId}/expenses/${expense.id}`)).status, 409);
  assert.equal(
    (await send(owner.cookie, "POST", `/api/trips/${tripId}/settlements`, {
      fromParticipantId: before.perCurrency[0]?.plan[0]?.fromParticipantId,
      toParticipantId: before.perCurrency[0]?.plan[0]?.toParticipantId,
      amountMinor: 1,
      currency: "KRW",
    })).status,
    409,
    "recorded payments are frozen too",
  );

  // The escape hatch, since v1 locks rather than versioning.
  assert.equal((await send(owner.cookie, "DELETE", `/api/trips/${tripId}/settle`)).status, 200);
  assert.equal((await send(owner.cookie, "PATCH", `/api/trips/${tripId}/expenses/${expense.id}`, { description: "Fixed" })).status, 200);
});

test("settling twice is refused", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await tripWithSeats(owner);

  assert.equal((await send(owner.cookie, "POST", `/api/trips/${tripId}/settle`)).status, 200, "nothing owed, so it settles");
  assert.equal((await send(owner.cookie, "POST", `/api/trips/${tripId}/settle`)).status, 409);
});

test("only an owner settles or reopens a trip", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const { tripId, sister } = await tripWithSeats(owner);

  const { token } = await body<{ token: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants/${sister.id}/invite`),
  );
  await send(member.cookie, "POST", `/api/invites/${token}/accept`);

  assert.equal((await send(member.cookie, "POST", `/api/trips/${tripId}/settle`)).status, 403);
  assert.equal((await send(member.cookie, "DELETE", `/api/trips/${tripId}/settle`)).status, 403);
  // But a member can see and record the money.
  assert.equal((await send(member.cookie, "GET", `/api/trips/${tripId}/settlement`)).status, 200);
});

test("a recorded payment can be removed if it was entered wrongly", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId, me, sister } = await tripWithSeats(owner);

  const payment = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/settlements`, {
      fromParticipantId: sister.id, toParticipantId: me, amountMinor: 5_000, currency: "KRW",
    }),
  );

  assert.equal(net(await settlement(owner.cookie, tripId), "KRW", sister.id), 5_000, "overpaid, so now owed");
  assert.equal((await send(owner.cookie, "DELETE", `/api/trips/${tripId}/settlements/${payment.id}`)).status, 204);
  assert.equal((await settlement(owner.cookie, tripId)).outstanding, false);
});

test("a payment needs two different people on this trip", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId, me } = await tripWithSeats(owner);
  const otherTrip = await h.createTrip(owner, "Elsewhere");
  const outsider = await created<Seat>(await send(owner.cookie, "POST", `/api/trips/${otherTrip}/participants`, { displayName: "Outsider" }));

  assert.equal(
    (await send(owner.cookie, "POST", `/api/trips/${tripId}/settlements`, { fromParticipantId: me, toParticipantId: me, amountMinor: 100, currency: "KRW" })).status,
    400,
    "paying yourself is not a payment",
  );
  assert.equal(
    (await send(owner.cookie, "POST", `/api/trips/${tripId}/settlements`, { fromParticipantId: me, toParticipantId: outsider.id, amountMinor: 100, currency: "KRW" })).status,
    400,
    "someone from another trip",
  );
  assert.equal(
    (await send(owner.cookie, "POST", `/api/trips/${tripId}/settlements`, { fromParticipantId: me, toParticipantId: outsider.id, amountMinor: -100, currency: "KRW" })).status,
    400,
    "negative payments are the same fact written backwards",
  );
});

test("the database refuses a nonsense payment even past the handlers", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId, me, sister } = await tripWithSeats(owner);

  const { getDb } = await import("../src/db/client.ts");
  const { settlements } = await import("../src/db/schema.ts");
  const base = { tripId, createdByUserId: owner.userId, settledOn: "2027-04-20", currency: "KRW" };

  await h.assertRefusedBy("settlements_amount_positive", () =>
    getDb().insert(settlements).values({ ...base, fromParticipantId: sister.id, toParticipantId: me, amountMinor: -5 }),
  );
  await h.assertRefusedBy("settlements_distinct_parties", () =>
    getDb().insert(settlements).values({ ...base, fromParticipantId: me, toParticipantId: me, amountMinor: 5 }),
  );
  await h.assertRefusedBy("settlements_currency_format", () =>
    getDb().insert(settlements).values({ ...base, currency: "won", fromParticipantId: sister.id, toParticipantId: me, amountMinor: 5 }),
  );
});

test("settlement is invisible to someone not on the trip", needsDb, async () => {
  const owner = await h.signUp();
  const stranger = await h.signUp();
  const { tripId } = await tripWithSeats(owner);

  assert.equal((await send(stranger.cookie, "GET", `/api/trips/${tripId}/settlement`)).status, 404);
  assert.equal((await send(stranger.cookie, "POST", `/api/trips/${tripId}/settle`)).status, 404);
});

test("the summary reports both the group's daily spend and mine", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await tripWithSeats(owner);
  const day = await created<{ id: string }>(await send(owner.cookie, "POST", `/api/trips/${tripId}/days`, { date: "2027-04-01" }));

  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Lunch", amountMinor: 30_000, currency: "KRW", dayId: day.id }));
  await created(await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, { description: "Souvenir", amountMinor: 9_000, currency: "KRW", dayId: day.id, isPrivate: true }));

  const summary = await body<{
    perDay: { dayId: string; totalMinor: number }[];
    minePerDay: { dayId: string; totalMinor: number }[];
  }>(await send(owner.cookie, "GET", `/api/trips/${tripId}/expenses/summary`));

  assert.equal(summary.perDay.find((d) => d.dayId === day.id)?.totalMinor, 30_000, "the group's day");
  assert.equal(
    summary.minePerDay.find((d) => d.dayId === day.id)?.totalMinor,
    10_000 + 9_000,
    "my third of lunch, plus my private souvenir",
  );
});
