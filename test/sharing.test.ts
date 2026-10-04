import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "./helpers.ts";

const hasDb = process.env.DATABASE_URL !== undefined;
const needsDb = hasDb ? {} : { skip: "DATABASE_URL not set" };
process.env.SESSION_SECRET ??= "test-secret-not-used-in-production";

const h = await import("./helpers.ts");
const { app, authed, json } = h;

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

const tokenFrom = (url: string): string => url.slice(url.lastIndexOf("/s/") + 3);

/** A trip with an itinerary, bookings, people and money — so the public view has things to omit. */
async function fullTrip(owner: Session) {
  const tripId = await h.createTrip(owner, "Korea");
  const seat = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants`, { displayName: "Priya" }),
  );
  const area = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/locations`, { name: "Seoul" }),
  );
  const day = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/days`, {
      date: "2027-04-12",
      locationIds: [area.id],
      notes: "Landed late, took it easy.",
    }),
  );
  await created(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/days/${day.id}/entries`, {
      kind: "meal",
      title: "Tteokbokki at the market",
      startsAt: "13:00",
      status: "done",
      notes: "Cash only, bring small notes",
      place: { name: "Gwangjang Market", country: "KR" },
    }),
  );
  const booking = await created<{ id: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/bookings`, {
      kind: "lodging",
      title: "Hongdae apartment",
      provider: "Airbnb",
      confirmationCode: "HMQ4R8ZK",
      startsAt: "2027-04-12T15:00:00Z",
    }),
  );
  await created(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/expenses`, {
      description: "Market lunch",
      amountMinor: 38_000,
      currency: "KRW",
      dayId: day.id,
    }),
  );
  return { tripId, seat, booking };
}

test("an owner can share a trip, and anyone with the link can read it", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await fullTrip(owner);

  const share = await body<{ url: string }>(await send(owner.cookie, "POST", `/api/trips/${tripId}/share`));
  assert.match(share.url, /\/s\//);

  // No session at all — that is the point of the link.
  const res = await app().request(`/api/shared/${tokenFrom(share.url)}`);
  assert.equal(res.status, 200);

  const shared = await body<{ name: string; days: { entries: { title: string }[] }[] }>(res);
  assert.equal(shared.name, "Korea");
  assert.equal(shared.days[0]?.entries[0]?.title, "Tteokbokki at the market");
});

test("nothing transactional travels with the link", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await fullTrip(owner);
  const share = await body<{ url: string }>(await send(owner.cookie, "POST", `/api/trips/${tripId}/share`));

  const raw = await (await app().request(`/api/shared/${tokenFrom(share.url)}`)).text();

  // Asserted against the whole serialised payload rather than a field list, so
  // a future field cannot quietly add one of these back.
  for (const leak of [
    "Market lunch", // an expense description
    "38000", // an amount
    "KRW", // a currency
    "Priya", // a participant
    "Hongdae apartment", // a booking
    "Airbnb", // a provider
    "HMQ4R8ZK", // a confirmation code
    "Cash only", // an entry note
    "paidBy",
    "amountMinor",
    "shares",
    "participants",
    "settle",
  ]) {
    assert.ok(!raw.includes(leak), `"${leak}" leaked into the public itinerary`);
  }

  // But the itinerary itself is all there.
  for (const kept of ["Korea", "Seoul", "Tteokbokki", "Gwangjang Market", "Landed late"]) {
    assert.ok(raw.includes(kept), `"${kept}" should be in the public itinerary`);
  }
});

test("only an owner can turn sharing on or off", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const { tripId, seat } = await fullTrip(owner);

  const { token } = await body<{ token: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants/${seat.id}/invite`),
  );
  await send(member.cookie, "POST", `/api/invites/${token}/accept`);

  assert.equal((await send(member.cookie, "POST", `/api/trips/${tripId}/share`)).status, 403);
  assert.equal((await send(member.cookie, "DELETE", `/api/trips/${tripId}/share`)).status, 403);

  const stranger = await h.signUp();
  assert.equal((await send(stranger.cookie, "POST", `/api/trips/${tripId}/share`)).status, 404);
});

test("the link appears to its owner but not to a member", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const { tripId, seat } = await fullTrip(owner);
  await send(owner.cookie, "POST", `/api/trips/${tripId}/share`);

  const { token } = await body<{ token: string }>(
    await send(owner.cookie, "POST", `/api/trips/${tripId}/participants/${seat.id}/invite`),
  );
  await send(member.cookie, "POST", `/api/invites/${token}/accept`);

  const asOwner = await body<{ share: { url: string } | null }>(
    await send(owner.cookie, "GET", `/api/trips/${tripId}`),
  );
  assert.ok(asOwner.share?.url, "an owner can re-copy the link");

  const asMember = await body<{ share: unknown; shareToken?: unknown }>(
    await send(member.cookie, "GET", `/api/trips/${tripId}`),
  );
  assert.equal(asMember.share, null, "a member cannot hand the link out");
  assert.equal(asMember.shareToken, undefined, "and the raw token never ships");
});

test("turning sharing off makes the link stop working", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await fullTrip(owner);
  const share = await body<{ url: string }>(await send(owner.cookie, "POST", `/api/trips/${tripId}/share`));
  const token = tokenFrom(share.url);

  assert.equal((await app().request(`/api/shared/${token}`)).status, 200);
  assert.equal((await send(owner.cookie, "DELETE", `/api/trips/${tripId}/share`)).status, 204);
  assert.equal((await app().request(`/api/shared/${token}`)).status, 404);
});

test("making a new link invalidates the old one, which is how you take it back", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await fullTrip(owner);

  const first = await body<{ url: string }>(await send(owner.cookie, "POST", `/api/trips/${tripId}/share`));
  const second = await body<{ url: string }>(await send(owner.cookie, "POST", `/api/trips/${tripId}/share`));

  assert.notEqual(first.url, second.url);
  assert.equal((await app().request(`/api/shared/${tokenFrom(first.url)}`)).status, 404);
  assert.equal((await app().request(`/api/shared/${tokenFrom(second.url)}`)).status, 200);
});

test("an unshared trip and a made-up token are equally unavailable", needsDb, async () => {
  const owner = await h.signUp();
  await fullTrip(owner);

  // The same answer either way, so a guess cannot tell a real trip from nothing.
  const guessed = await app().request(`/api/shared/${crypto.randomUUID()}`);
  assert.equal(guessed.status, 404);
  assert.deepEqual(await body(guessed), { error: "this link is not available" });
});

test("sharing needs a session to switch on", needsDb, async () => {
  const owner = await h.signUp();
  const { tripId } = await fullTrip(owner);
  assert.equal((await app().request(`/api/trips/${tripId}/share`, json("POST"))).status, 401);
});
