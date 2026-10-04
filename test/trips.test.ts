import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

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

test("creating a trip makes the creator its owner", needsDb, async () => {
  const me = await h.signUp();
  const res = await app().request("/api/trips", authed(me.cookie, "POST", { name: "Korea" }));
  assert.equal(res.status, 201);

  const trip = (await res.json()) as { id: string; status: string; homeCurrency: string };
  assert.equal(trip.status, "planning");
  assert.equal(trip.homeCurrency, "CAD");

  const detail = await app().request(`/api/trips/${trip.id}`, authed(me.cookie));
  const body = (await detail.json()) as {
    role: string;
    participants: { role: string; hasAccount: boolean }[];
  };
  assert.equal(body.role, "owner");
  assert.equal(body.participants.length, 1);
  assert.equal(body.participants[0]?.role, "owner");
  assert.equal(body.participants[0]?.hasAccount, true);
});

test("a trip is invisible to someone who is not on it, as a 404 not a 403", needsDb, async () => {
  const [mine, stranger] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(mine);

  // 403 would confirm the trip exists, which a stranger has not earned.
  assert.equal((await app().request(`/api/trips/${tripId}`, authed(stranger.cookie))).status, 404);
  assert.equal((await app().request(`/api/trips/${tripId}`, authed(stranger.cookie, "DELETE"))).status, 404);

  const list = await app().request("/api/trips", authed(stranger.cookie));
  assert.deepEqual(await list.json(), []);
});

test("the trip list puts upcoming trips first, then past, then undated", needsDb, async () => {
  const me = await h.signUp();
  const year = new Date().getUTCFullYear();

  // Created in a deliberately unhelpful order.
  for (const trip of [
    { name: "Wishlist" },
    { name: "Long past", startDate: `${year - 5}-03-01`, endDate: `${year - 5}-03-10` },
    { name: "Far future", startDate: `${year + 4}-01-01`, endDate: `${year + 4}-01-10` },
    { name: "Recent past", startDate: `${year - 1}-06-01`, endDate: `${year - 1}-06-10` },
    { name: "Next up", startDate: `${year + 1}-02-01`, endDate: `${year + 1}-02-10` },
  ]) {
    await app().request("/api/trips", authed(me.cookie, "POST", trip));
  }

  const rows = (await (await app().request("/api/trips", authed(me.cookie))).json()) as {
    name: string;
  }[];

  assert.deepEqual(
    rows.map((r) => r.name),
    ["Next up", "Far future", "Recent past", "Long past", "Wishlist"],
    "upcoming soonest-first, then past most-recent-first, then undated",
  );
});

test("a trip cannot end before it starts, on create or on a partial patch", needsDb, async () => {
  const me = await h.signUp();

  const bad = await app().request(
    "/api/trips",
    authed(me.cookie, "POST", { name: "Backwards", startDate: "2026-05-10", endDate: "2026-05-01" }),
  );
  assert.equal(bad.status, 400);

  const tripId = await h.createTrip(me);
  await app().request(`/api/trips/${tripId}`, authed(me.cookie, "PATCH", { startDate: "2026-05-10" }));

  // Only endDate is supplied, so it has to be checked against the stored start.
  const patched = await app().request(
    `/api/trips/${tripId}`,
    authed(me.cookie, "PATCH", { endDate: "2026-05-01" }),
  );
  assert.equal(patched.status, 400);
});

test("an empty patch is rejected rather than silently doing nothing", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  assert.equal((await app().request(`/api/trips/${tripId}`, authed(me.cookie, "PATCH", {}))).status, 400);
});

test("currency is normalised to uppercase", needsDb, async () => {
  const me = await h.signUp();
  const res = await app().request(
    "/api/trips",
    authed(me.cookie, "POST", { name: "Japan", homeCurrency: "krw" }),
  );
  assert.equal(((await res.json()) as { homeCurrency: string }).homeCurrency, "KRW");
});

test("a seat can exist with no account behind it", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  const res = await app().request(
    `/api/trips/${tripId}/participants`,
    authed(me.cookie, "POST", { displayName: "My sister" }),
  );
  assert.equal(res.status, 201);

  const detail = await app().request(`/api/trips/${tripId}`, authed(me.cookie));
  const { participants } = (await detail.json()) as {
    participants: { displayName: string; hasAccount: boolean }[];
  };
  const sister = participants.find((p) => p.displayName === "My sister");
  assert.equal(sister?.hasAccount, false, "an unclaimed seat has no account");
});

test("the last owner cannot be removed, or nobody could administer the trip", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  const detail = await app().request(`/api/trips/${tripId}`, authed(me.cookie));
  const { participants } = (await detail.json()) as { participants: { id: string; role: string }[] };
  const owner = participants.find((p) => p.role === "owner");

  const res = await app().request(
    `/api/trips/${tripId}/participants/${owner?.id}`,
    authed(me.cookie, "DELETE"),
  );
  assert.equal(res.status, 409);
});

test("an invite claims the seat it was issued for", needsDb, async () => {
  const [owner, guest] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);

  const seat = (await (
    await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: "Guest" }))
  ).json()) as { id: string };

  const invite = (await (
    await app().request(
      `/api/trips/${tripId}/participants/${seat.id}/invite`,
      authed(owner.cookie, "POST"),
    )
  ).json()) as { token: string; url: string };

  assert.match(invite.url, /\/invite\//);

  const accepted = await app().request(`/api/invites/${invite.token}/accept`, authed(guest.cookie, "POST"));
  assert.equal(accepted.status, 200);
  // The existing seat is claimed, not a new one created (ADR-0005).
  assert.equal(((await accepted.json()) as { participantId: string }).participantId, seat.id);

  const detail = await app().request(`/api/trips/${tripId}`, authed(guest.cookie));
  assert.equal(detail.status, 200);
  assert.equal(((await detail.json()) as { role: string }).role, "member");
});

test("the invite preview works without a session and leaks nothing extra", needsDb, async () => {
  const owner = await h.signUp();
  const tripId = await h.createTrip(owner, "Secret Trip");
  const seat = (await (
    await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: "Guest" }))
  ).json()) as { id: string };
  const invite = (await (
    await app().request(`/api/trips/${tripId}/participants/${seat.id}/invite`, authed(owner.cookie, "POST"))
  ).json()) as { token: string };

  const preview = await app().request(`/api/invites/${invite.token}`);
  assert.equal(preview.status, 200);

  const body = (await preview.json()) as Record<string, unknown>;
  assert.equal(body.state, "valid");
  assert.equal(body.tripName, "Secret Trip");
  assert.equal(body.seatName, "Guest");
  assert.equal(body.signedIn, false);
  // No ids, no participant list, no other members.
  assert.deepEqual(Object.keys(body).sort(), ["seatName", "signedIn", "state", "tripName"]);
});

test("an invite is single-use", needsDb, async () => {
  const [owner, first, second] = [await h.signUp(), await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);
  const seat = (await (
    await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: "Guest" }))
  ).json()) as { id: string };
  const { token } = (await (
    await app().request(`/api/trips/${tripId}/participants/${seat.id}/invite`, authed(owner.cookie, "POST"))
  ).json()) as { token: string };

  assert.equal((await app().request(`/api/invites/${token}/accept`, authed(first.cookie, "POST"))).status, 200);
  assert.equal((await app().request(`/api/invites/${token}/accept`, authed(second.cookie, "POST"))).status, 409);
});

test("one account cannot occupy two seats on the same trip", needsDb, async () => {
  const [owner, guest] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);

  const tokens: string[] = [];
  for (const name of ["Seat A", "Seat B"]) {
    const seat = (await (
      await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: name }))
    ).json()) as { id: string };
    const { token } = (await (
      await app().request(`/api/trips/${tripId}/participants/${seat.id}/invite`, authed(owner.cookie, "POST"))
    ).json()) as { token: string };
    tokens.push(token);
  }

  assert.equal((await app().request(`/api/invites/${tokens[0]}/accept`, authed(guest.cookie, "POST"))).status, 200);

  // Enforced by the partial unique index, surfaced as a conflict not a 500.
  const second = await app().request(`/api/invites/${tokens[1]}/accept`, authed(guest.cookie, "POST"));
  assert.equal(second.status, 409);
  assert.match(((await second.json()) as { error: string }).error, /already on this trip/);
});

test("a revoked invite cannot be accepted", needsDb, async () => {
  const [owner, guest] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);
  const seat = (await (
    await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: "Guest" }))
  ).json()) as { id: string };
  const invite = (await (
    await app().request(`/api/trips/${tripId}/participants/${seat.id}/invite`, authed(owner.cookie, "POST"))
  ).json()) as { id: string; token: string };

  assert.equal((await app().request(`/api/invites/${invite.id}`, authed(owner.cookie, "DELETE"))).status, 204);

  const res = await app().request(`/api/invites/${invite.token}/accept`, authed(guest.cookie, "POST"));
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /revoked/);
});

test("an expired invite cannot be accepted", needsDb, async () => {
  const [owner, guest] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);
  const seat = (await (
    await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: "Guest" }))
  ).json()) as { id: string };
  const invite = (await (
    await app().request(`/api/trips/${tripId}/participants/${seat.id}/invite`, authed(owner.cookie, "POST"))
  ).json()) as { id: string; token: string };

  // Backdated directly: waiting out the real TTL is not a test.
  const { getDb } = await import("../src/db/client.ts");
  const { tripInvites } = await import("../src/db/schema.ts");
  await getDb()
    .update(tripInvites)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(tripInvites.id, invite.id));

  const res = await app().request(`/api/invites/${invite.token}/accept`, authed(guest.cookie, "POST"));
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /expired/);
});

test("only an owner manages the trip, its seats and its invites", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);

  const seat = (await (
    await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: "Guest" }))
  ).json()) as { id: string };
  const { token } = (await (
    await app().request(`/api/trips/${tripId}/participants/${seat.id}/invite`, authed(owner.cookie, "POST"))
  ).json()) as { token: string };
  await app().request(`/api/invites/${token}/accept`, authed(member.cookie, "POST"));

  // A member can read the trip but not administer it.
  assert.equal((await app().request(`/api/trips/${tripId}`, authed(member.cookie))).status, 200);
  assert.equal((await app().request(`/api/trips/${tripId}`, authed(member.cookie, "PATCH", { name: "Hijacked" }))).status, 403);
  assert.equal((await app().request(`/api/trips/${tripId}`, authed(member.cookie, "DELETE"))).status, 403);
  assert.equal(
    (await app().request(`/api/trips/${tripId}/participants`, authed(member.cookie, "POST", { displayName: "X" }))).status,
    403,
  );
});

test("an already-claimed seat cannot be re-invited", needsDb, async () => {
  const [owner, guest] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);
  const seat = (await (
    await app().request(`/api/trips/${tripId}/participants`, authed(owner.cookie, "POST", { displayName: "Guest" }))
  ).json()) as { id: string };
  const { token } = (await (
    await app().request(`/api/trips/${tripId}/participants/${seat.id}/invite`, authed(owner.cookie, "POST"))
  ).json()) as { token: string };
  await app().request(`/api/invites/${token}/accept`, authed(guest.cookie, "POST"));

  const again = await app().request(
    `/api/trips/${tripId}/participants/${seat.id}/invite`,
    authed(owner.cookie, "POST"),
  );
  assert.equal(again.status, 409);
});

test("trip endpoints require a session", needsDb, async () => {
  assert.equal((await app().request("/api/trips")).status, 401);
  assert.equal((await app().request("/api/trips", h.json("POST", { name: "X" }))).status, 401);
});
