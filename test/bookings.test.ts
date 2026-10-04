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

const asJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** Asserts the call succeeded before returning its body. */
async function created<T>(res: Response): Promise<T> {
  assert.equal(res.status, 201, `setup failed: ${res.status} ${await res.clone().text()}`);
  return asJson<T>(res);
}

/** A trip with three dated days, which is what lodging and transit hang off. */
async function tripWithDays(session: Session) {
  const tripId = await h.createTrip(session, "Korea");
  const dayIds: string[] = [];
  for (const date of ["2027-04-01", "2027-04-02", "2027-04-03"]) {
    const day = await created<{ id: string }>(
      await send(session.cookie, "POST", `/api/trips/${tripId}/days`, { date }),
    );
    dayIds.push(day.id);
  }
  return { tripId, dayIds };
}

const lodging = (over: Record<string, unknown> = {}) => ({
  kind: "lodging",
  title: "Seoul apartment",
  provider: "Airbnb",
  confirmationCode: "HMABC123",
  startsAt: "2027-04-01T15:00:00Z",
  endsAt: "2027-04-14T11:00:00Z",
  ...over,
});

const flight = (over: Record<string, unknown> = {}) => ({
  kind: "transit",
  title: "YYZ → ICN",
  provider: "Air Canada",
  startsAt: "2027-04-01T01:00:00Z",
  endsAt: "2027-04-01T18:00:00Z",
  ...over,
});

test("lodging, transit and events are one registry", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  for (const booking of [lodging(), flight(), { kind: "event", title: "DMZ tour", startsAt: "2027-04-05T09:00:00Z" }]) {
    assert.equal((await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, booking)).status, 201, booking.title);
  }

  const rows = await asJson<{ kind: string; usedDayCount: number }[]>(
    await send(me.cookie, "GET", `/api/trips/${tripId}/bookings`),
  );
  assert.deepEqual(rows.map((b) => b.kind).sort(), ["event", "lodging", "transit"]);
});

test("a booking cannot end before it begins, on create or a partial patch", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  const bad = await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging({ endsAt: "2027-03-01T11:00:00Z" }));
  assert.equal(bad.status, 400);

  const ok = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging()));
  // Only endsAt is supplied, so it must be compared against the stored start.
  const patched = await send(me.cookie, "PATCH", `/api/trips/${tripId}/bookings/${ok.id}`, {
    endsAt: "2027-03-01T11:00:00Z",
  });
  assert.equal(patched.status, 400);
});

test("paid-for nights and used nights are allowed to differ", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);

  // Booked for two weeks; slept in for one night. This is the case that made
  // day links explicit rather than derived from date overlap.
  const stay = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging()));
  assert.equal((await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: stay.id })).status, 200);

  const [booking] = await asJson<{ usedDayCount: number }[]>(
    await send(me.cookie, "GET", `/api/trips/${tripId}/bookings`),
  );
  assert.equal(booking?.usedDayCount, 1, "one night used out of fourteen booked, reported not corrected");
});

test("only a lodging booking can be a place to sleep", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);
  const plane = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, flight()));

  const res = await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: plane.id });
  assert.equal(res.status, 400);
  assert.match((await asJson<{ error: string }>(res)).error, /lodging/);
});

test("a cancelled stay stays assignable to the nights it was actually used", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);

  const stay = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging()));
  await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: stay.id });

  // Cancelled midway — the nights already slept there do not become untrue.
  assert.equal((await send(me.cookie, "PATCH", `/api/trips/${tripId}/bookings/${stay.id}`, { status: "cancelled" })).status, 200);
  assert.equal(
    (await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[1]}/lodging`, { bookingId: stay.id })).status,
    200,
    "still assignable after cancellation",
  );
});

test("lodging is single-valued and clearable", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);
  const a = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging()));
  const b = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging({ title: "Busan hotel" })));

  await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: a.id });
  // Replacing, not adding: a night has one bed.
  await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: b.id });

  let days = await asJson<{ lodging: { title: string } | null }[]>(await send(me.cookie, "GET", `/api/trips/${tripId}/days`));
  assert.equal(days[0]?.lodging?.title, "Busan hotel");

  await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: null });
  days = await asJson<{ lodging: { title: string } | null }[]>(await send(me.cookie, "GET", `/api/trips/${tripId}/days`));
  assert.equal(days[0]?.lodging, null, "a night with no booked bed is normal");
});

test("a day can use several transit bookings, but not lodging", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);

  const plane = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, flight()));
  const train = await created<{ id: string }>(
    await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, flight({
      title: "Airport express",
      startsAt: "2027-04-01T19:00:00Z",
      endsAt: "2027-04-01T20:00:00Z",
    })),
  );
  const stay = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging()));

  assert.equal(
    (await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/bookings`, { bookingIds: [plane.id, train.id] })).status,
    200,
  );

  const days = await asJson<{ bookings: { title: string }[] }[]>(await send(me.cookie, "GET", `/api/trips/${tripId}/days`));
  assert.deepEqual(days[0]?.bookings.map((b) => b.title), ["YYZ → ICN", "Airport express"]);

  const withLodging = await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/bookings`, {
    bookingIds: [plane.id, stay.id],
  });
  assert.equal(withLodging.status, 400, "lodging belongs on the night, not in this list");
});

test("another trip's booking cannot be linked", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);
  const otherTrip = await h.createTrip(me, "Elsewhere");
  const foreign = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${otherTrip}/bookings`, flight()));

  assert.equal(
    (await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/bookings`, { bookingIds: [foreign.id] })).status,
    400,
  );
  assert.equal(
    (await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: foreign.id })).status,
    404,
  );
});

test("a linked booking cannot change kind underneath its days", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);
  const stay = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging()));
  await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: stay.id });

  const res = await send(me.cookie, "PATCH", `/api/trips/${tripId}/bookings/${stay.id}`, { kind: "transit" });
  assert.equal(res.status, 409);

  // Unlink first, then it is allowed.
  await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: null });
  assert.equal((await send(me.cookie, "PATCH", `/api/trips/${tripId}/bookings/${stay.id}`, { kind: "transit" })).status, 200);
});

test("deleting a booking leaves its days intact", needsDb, async () => {
  const me = await h.signUp();
  const { tripId, dayIds } = await tripWithDays(me);
  const stay = await created<{ id: string }>(await send(me.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging()));
  await send(me.cookie, "PUT", `/api/trips/${tripId}/days/${dayIds[0]}/lodging`, { bookingId: stay.id });

  assert.equal((await send(me.cookie, "DELETE", `/api/trips/${tripId}/bookings/${stay.id}`)).status, 204);

  const days = await asJson<{ dayNumber: number; lodging: unknown }[]>(await send(me.cookie, "GET", `/api/trips/${tripId}/days`));
  assert.equal(days.length, 3, "days survive losing the booking they pointed at");
  assert.equal(days[0]?.lodging, null);
});

test("bookings are invisible to someone not on the trip", needsDb, async () => {
  const me = await h.signUp();
  const stranger = await h.signUp();
  const tripId = await h.createTrip(me);

  assert.equal((await send(stranger.cookie, "GET", `/api/trips/${tripId}/bookings`)).status, 404);
  assert.equal((await send(stranger.cookie, "POST", `/api/trips/${tripId}/bookings`, lodging())).status, 404);
});

test("a seat can be renamed, which is what the creator's placeholder needs", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  const detail = await asJson<{ participants: { id: string; displayName: string }[] }>(
    await send(me.cookie, "GET", `/api/trips/${tripId}`),
  );
  const own = detail.participants[0];
  assert.equal(own?.displayName, "Me", "the placeholder this closes");

  const res = await send(me.cookie, "PATCH", `/api/trips/${tripId}/participants/${own?.id}`, { displayName: "Nandan" });
  assert.equal(res.status, 200);
  assert.equal((await asJson<{ displayName: string }>(res)).displayName, "Nandan");
});

test("a member renames their own seat but not someone else's, and cannot grant roles", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);

  const seat = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants`, { displayName: "Guest" }),
  );
  const { token } = await asJson<{ token: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants/${seat.id}/invite`),
  );
  await send(member.cookie, "POST", `/api/invites/${token}/accept`);

  assert.equal(
    (await send(member.cookie, "PATCH", `/api/trips/${tripId}/participants/${seat.id}`, { displayName: "Sister" })).status,
    200,
    "own seat",
  );

  const ownerSeat = (
    await asJson<{ participants: { id: string; role: string }[] }>(await send(owner.cookie, "GET", `/api/trips/${tripId}`))
  ).participants.find((p) => p.role === "owner");

  assert.equal(
    (await send(member.cookie, "PATCH", `/api/trips/${tripId}/participants/${ownerSeat?.id}`, { displayName: "Hijack" })).status,
    403,
    "someone else's seat",
  );
  assert.equal(
    (await send(member.cookie, "PATCH", `/api/trips/${tripId}/participants/${seat.id}`, { role: "owner" })).status,
    403,
    "self-promotion",
  );
});

test("the last owner cannot be demoted, for the same reason they cannot be removed", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  const own = (
    await asJson<{ participants: { id: string; role: string }[] }>(await send(me.cookie, "GET", `/api/trips/${tripId}`))
  ).participants.find((p) => p.role === "owner");

  const res = await send(me.cookie, "PATCH", `/api/trips/${tripId}/participants/${own?.id}`, { role: "member" });
  assert.equal(res.status, 409);
});
