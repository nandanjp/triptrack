import { test, after } from "node:test";
import assert from "node:assert/strict";

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

const post = async (cookie: string, path: string, body?: unknown) =>
  app().request(path, authed(cookie, "POST", body));
const get = async (cookie: string, path: string) => app().request(path, authed(cookie));

const days = async (cookie: string, tripId: string) =>
  (await (await get(cookie, `/api/trips/${tripId}/days`)).json()) as {
    id: string;
    dayNumber: number;
    date: string | null;
    locations: { id: string; name: string }[];
    entries: {
      id: string;
      title: string;
      status: string;
      startsAt: string | null;
      replacedByEntryId: string | null;
      placeName: string | null;
      attendees: { participantId: string; displayName: string }[];
    }[];
  }[];

test("the itinerary router is reachable alongside the trips router", needsDb, async () => {
  // Both are mounted at /api/trips; this fails if Hono does not fall through
  // from the first sub-app to the second.
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  assert.equal((await get(me.cookie, `/api/trips/${tripId}`)).status, 200, "trips router");
  assert.equal((await get(me.cookie, `/api/trips/${tripId}/days`)).status, 200, "itinerary router");
  assert.equal((await get(me.cookie, `/api/trips/${tripId}/locations`)).status, 200, "itinerary router");
});

test("locations derive their day count instead of enforcing an allocation", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  const seoul = (await (await post(me.cookie, `/api/trips/${tripId}/locations`, { name: "Seoul" })).json()) as { id: string };
  const busan = (await (await post(me.cookie, `/api/trips/${tripId}/locations`, { name: "Busan" })).json()) as { id: string };

  for (const date of ["2027-04-01", "2027-04-02", "2027-04-03"]) {
    await post(me.cookie, `/api/trips/${tripId}/days`, { date, locationIds: [seoul.id] });
  }
  await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-04", locationIds: [busan.id] });

  const locations = (await (await get(me.cookie, `/api/trips/${tripId}/locations`)).json()) as {
    name: string;
    dayCount: number;
  }[];

  assert.deepEqual(
    Object.fromEntries(locations.map((l) => [l.name, l.dayCount])),
    { Seoul: 3, Busan: 1 },
    "3 days in Seoul is a consequence of the itinerary, never a constraint",
  );
});

test("a travel day spans two locations, in order", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  const seoul = (await (await post(me.cookie, `/api/trips/${tripId}/locations`, { name: "Seoul" })).json()) as { id: string };
  const busan = (await (await post(me.cookie, `/api/trips/${tripId}/locations`, { name: "Busan" })).json()) as { id: string };

  await post(me.cookie, `/api/trips/${tripId}/days`, {
    date: "2027-04-05",
    locationIds: [seoul.id, busan.id],
  });

  const [day] = await days(me.cookie, tripId);
  assert.deepEqual(day?.locations.map((l) => l.name), ["Seoul", "Busan"], "order carries direction");
});

test("inserting a day mid-trip renumbers without tripping the unique index", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);

  for (const date of ["2027-04-01", "2027-04-02", "2027-04-03"]) {
    await post(me.cookie, `/api/trips/${tripId}/days`, { date });
  }

  // Day 2 and everything after must shift up. A single UPDATE would collide
  // with the rows it had not reached yet.
  const inserted = await post(me.cookie, `/api/trips/${tripId}/days`, {
    date: "2027-04-10",
    atDayNumber: 2,
  });
  assert.equal(inserted.status, 201);

  const list = await days(me.cookie, tripId);
  assert.deepEqual(list.map((d) => d.dayNumber), [1, 2, 3, 4], "numbers stay contiguous");
  assert.deepEqual(
    list.map((d) => d.date),
    ["2027-04-01", "2027-04-10", "2027-04-02", "2027-04-03"],
    "the new day takes position 2 and the rest move down",
  );
});

test("deleting a day closes the gap, so day 4 still means the fourth day", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  for (const date of ["2027-04-01", "2027-04-02", "2027-04-03"]) {
    await post(me.cookie, `/api/trips/${tripId}/days`, { date });
  }

  const before = await days(me.cookie, tripId);
  const second = before[1];
  assert.equal(
    (await app().request(`/api/trips/${tripId}/days/${second?.id}`, authed(me.cookie, "DELETE"))).status,
    204,
  );

  const after = await days(me.cookie, tripId);
  assert.deepEqual(after.map((d) => d.dayNumber), [1, 2]);
  assert.deepEqual(after.map((d) => d.date), ["2027-04-01", "2027-04-03"]);
});

test("shifting a trip by one day moves consecutive dates without colliding", needsDb, async () => {
  const me = await h.signUp();
  const create = await app().request(
    "/api/trips",
    authed(me.cookie, "POST", { name: "Shiftable", startDate: "2027-04-01", endDate: "2027-04-03" }),
  );
  const tripId = ((await create.json()) as { id: string }).id;

  for (const date of ["2027-04-01", "2027-04-02", "2027-04-03"]) {
    await post(me.cookie, `/api/trips/${tripId}/days`, { date });
  }

  // +1 is the adversarial case: every date lands on the next one's old value.
  const shifted = await post(me.cookie, `/api/trips/${tripId}/days/shift`, { byDays: 1 });
  assert.equal(shifted.status, 200, await shifted.text());

  assert.deepEqual(
    (await days(me.cookie, tripId)).map((d) => d.date),
    ["2027-04-02", "2027-04-03", "2027-04-04"],
  );

  const trip = (await (await get(me.cookie, `/api/trips/${tripId}`)).json()) as {
    startDate: string;
    endDate: string;
  };
  assert.deepEqual([trip.startDate, trip.endDate], ["2027-04-02", "2027-04-04"], "the trip range moves too");
});

test("shifting backwards also survives the overlap", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  for (const date of ["2027-04-01", "2027-04-02", "2027-04-03"]) {
    await post(me.cookie, `/api/trips/${tripId}/days`, { date });
  }

  assert.equal((await post(me.cookie, `/api/trips/${tripId}/days/shift`, { byDays: -1 })).status, 200);
  assert.deepEqual(
    (await days(me.cookie, tripId)).map((d) => d.date),
    ["2027-03-31", "2027-04-01", "2027-04-02"],
  );
});

test("an undated trip still has an itinerary, and shifting leaves it alone", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me, "Someday");
  await post(me.cookie, `/api/trips/${tripId}/days`, {});
  await post(me.cookie, `/api/trips/${tripId}/days`, {});

  assert.equal((await post(me.cookie, `/api/trips/${tripId}/days/shift`, { byDays: 7 })).status, 200);
  const list = await days(me.cookie, tripId);
  assert.deepEqual(list.map((d) => d.dayNumber), [1, 2]);
  assert.deepEqual(list.map((d) => d.date), [null, null]);
});

test("a spontaneous find is an entry born done, not a separate concept", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  const day = (await (await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).json()) as { id: string };

  const planned = await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, {
    kind: "activity",
    title: "Gyeongbokgung",
  });
  assert.equal(((await planned.json()) as { status: string }).status, "planned");

  const found = await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, {
    kind: "meal",
    title: "Tiny tteokbokki place we stumbled on",
    status: "done",
  });
  assert.equal(found.status, 201);
  assert.equal(((await found.json()) as { status: string }).status, "done");
});

test("attendance defaults to the current participants and is materialised", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  await post(me.cookie, `/api/trips/${tripId}/participants`, { displayName: "Sister" });

  const day = (await (await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).json()) as { id: string };
  await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, { kind: "activity", title: "Hike" });

  const [first] = await days(me.cookie, tripId);
  assert.equal(first?.entries[0]?.attendees.length, 2, "both existing seats attend by default");

  // Someone joining later must not be added to an entry that predates them.
  await post(me.cookie, `/api/trips/${tripId}/participants`, { displayName: "Late arrival" });
  const [again] = await days(me.cookie, tripId);
  assert.equal(
    again?.entries[0]?.attendees.length,
    2,
    "a late joiner is not retroactively an attendee",
  );
});

test("attendance can be narrowed when the group splits up", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  const detail = (await (await get(me.cookie, `/api/trips/${tripId}`)).json()) as {
    participants: { id: string; role: string }[];
  };
  const owner = detail.participants[0];
  await post(me.cookie, `/api/trips/${tripId}/participants`, { displayName: "Other" });

  const day = (await (await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).json()) as { id: string };
  const entry = (await (
    await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, {
      kind: "activity",
      title: "Kyoto, just me",
      attendeeIds: [owner?.id],
    })
  ).json()) as { id: string };

  const [d] = await days(me.cookie, tripId);
  assert.equal(d?.entries[0]?.attendees.length, 1);

  // And an outsider's participant id is rejected rather than silently ignored.
  const other = await h.signUp();
  const otherTrip = await h.createTrip(other);
  const otherDetail = (await (await get(other.cookie, `/api/trips/${otherTrip}`)).json()) as {
    participants: { id: string }[];
  };
  const res = await app().request(
    `/api/trips/${tripId}/entries/${entry.id}/attendees`,
    authed(me.cookie, "PUT", { participantIds: [otherDetail.participants[0]?.id] }),
  );
  assert.equal(res.status, 400);
});

test("a skipped entry can point at what replaced it", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  const day = (await (await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).json()) as { id: string };

  const museum = (await (
    await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, { kind: "activity", title: "Teshima museum" })
  ).json()) as { id: string };
  const beach = (await (
    await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, { kind: "activity", title: "Beach", status: "done" })
  ).json()) as { id: string };

  const res = await post(me.cookie, `/api/trips/${tripId}/entries/${museum.id}/status`, {
    status: "skipped",
    replacedByEntryId: beach.id,
  });
  assert.equal(res.status, 200);

  const body = (await res.json()) as { status: string; replacedByEntryId: string };
  assert.equal(body.status, "skipped");
  assert.equal(body.replacedByEntryId, beach.id, "the plan survives alongside what happened");
});

test("a replacement must be a different entry on the same trip", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  const day = (await (await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).json()) as { id: string };
  const entry = (await (
    await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, { kind: "activity", title: "A" })
  ).json()) as { id: string };

  const self = await post(me.cookie, `/api/trips/${tripId}/entries/${entry.id}/status`, {
    status: "skipped",
    replacedByEntryId: entry.id,
  });
  assert.equal(self.status, 400);

  // An entry on someone else's trip must not be referenceable.
  const other = await h.signUp();
  const otherTrip = await h.createTrip(other);
  const otherDay = (await (await post(other.cookie, `/api/trips/${otherTrip}/days`, { date: "2027-04-01" })).json()) as { id: string };
  const foreign = (await (
    await post(other.cookie, `/api/trips/${otherTrip}/days/${otherDay.id}/entries`, { kind: "activity", title: "B" })
  ).json()) as { id: string };

  const cross = await post(me.cookie, `/api/trips/${tripId}/entries/${entry.id}/status`, {
    status: "skipped",
    replacedByEntryId: foreign.id,
  });
  assert.equal(cross.status, 400);

  // A done entry has nothing to be replaced by.
  const done = await post(me.cookie, `/api/trips/${tripId}/entries/${entry.id}/status`, {
    status: "done",
    replacedByEntryId: foreign.id,
  });
  assert.equal(done.status, 400);
});

test("places dedupe on their external reference across trips", needsDb, async () => {
  const me = await h.signUp();
  const ref = `osm:${crypto.randomUUID()}`;

  const ids: (string | null)[] = [];
  for (const name of ["Trip A", "Trip B"]) {
    const tripId = await h.createTrip(me, name);
    const day = (await (await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).json()) as { id: string };
    const entry = (await (
      await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, {
        kind: "meal",
        title: "That ramen place",
        place: { name: "Ichiran", externalRef: ref, country: "JP" },
      })
    ).json()) as { placeId: string | null };
    ids.push(entry.placeId);
  }

  assert.ok(ids[0]);
  assert.equal(ids[0], ids[1], "one venue, one row — this is what cross-trip history needs");
});

test("entries order timed before untimed", needsDb, async () => {
  const me = await h.signUp();
  const tripId = await h.createTrip(me);
  const day = (await (await post(me.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).json()) as { id: string };

  await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, { kind: "activity", title: "Whenever" });
  await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, { kind: "meal", title: "Dinner", startsAt: "19:30" });
  await post(me.cookie, `/api/trips/${tripId}/days/${day.id}/entries`, { kind: "meal", title: "Breakfast", startsAt: "08:00" });

  const [d] = await days(me.cookie, tripId);
  assert.deepEqual(d?.entries.map((e) => e.title), ["Breakfast", "Dinner", "Whenever"]);
});

test("the itinerary is invisible to someone not on the trip", needsDb, async () => {
  const me = await h.signUp();
  const stranger = await h.signUp();
  const tripId = await h.createTrip(me);

  for (const path of [`/api/trips/${tripId}/days`, `/api/trips/${tripId}/locations`]) {
    assert.equal((await get(stranger.cookie, path)).status, 404, path);
  }
  assert.equal((await post(stranger.cookie, `/api/trips/${tripId}/days`, {})).status, 404);
  assert.equal((await post(stranger.cookie, `/api/trips/${tripId}/days/shift`, { byDays: 1 })).status, 404);
});

test("a member can edit the itinerary, because the group plans together", needsDb, async () => {
  const [owner, member] = [await h.signUp(), await h.signUp()];
  const tripId = await h.createTrip(owner);

  const seat = (await (await post(owner.cookie, `/api/trips/${tripId}/participants`, { displayName: "Guest" })).json()) as { id: string };
  const { token } = (await (
    await post(owner.cookie, `/api/trips/${tripId}/participants/${seat.id}/invite`)
  ).json()) as { token: string };
  await post(member.cookie, `/api/invites/${token}/accept`);

  assert.equal((await post(member.cookie, `/api/trips/${tripId}/days`, { date: "2027-04-01" })).status, 201);
  assert.equal((await post(member.cookie, `/api/trips/${tripId}/locations`, { name: "Jeju" })).status, 201);
});
