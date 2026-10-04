import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests: they need a real Postgres, because what is being checked
 * is the unique constraint and the queries, not the handler logic in isolation.
 * Skipped rather than failed when no database is configured, so `npm test`
 * stays useful on a machine without one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? { skip: "DATABASE_URL not set" } : {};

process.env.SESSION_SECRET ??= "test-secret-not-used-in-production";

const email = () => `user-${crypto.randomUUID()}@example.test`;
const PASSWORD = "a-sufficiently-long-password";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

let createApp: typeof import("../src/app.ts").createApp;
let closeDb: typeof import("../src/db/client.ts").closeDb;

before(async () => {
  if (DATABASE_URL === undefined) return;
  ({ createApp } = await import("../src/app.ts"));
  ({ closeDb } = await import("../src/db/client.ts"));
});

after(async () => {
  await closeDb?.();
});

test("register creates an account and starts a session", describeDb, async () => {
  const app = createApp();
  const res = await app.request("/api/auth/register", json({ email: email(), password: PASSWORD }));

  assert.equal(res.status, 201);
  assert.match(res.headers.get("set-cookie") ?? "", /triptrack_session=/);
  assert.ok((await res.json() as { id: string }).id);
});

test("registering the same email twice is a conflict, not a 500", describeDb, async () => {
  const app = createApp();
  const address = email();

  assert.equal((await app.request("/api/auth/register", json({ email: address, password: PASSWORD }))).status, 201);

  const second = await app.request("/api/auth/register", json({ email: address, password: PASSWORD }));
  assert.equal(second.status, 409);
});

test("email is normalised, so case and whitespace cannot duplicate an account", describeDb, async () => {
  const app = createApp();
  const address = email();

  await app.request("/api/auth/register", json({ email: address, password: PASSWORD }));
  const dupe = await app.request("/api/auth/register", json({ email: `  ${address.toUpperCase()}  `, password: PASSWORD }));

  assert.equal(dupe.status, 409);
});

test("login succeeds with the right password and 401s with the wrong one", describeDb, async () => {
  const app = createApp();
  const address = email();
  await app.request("/api/auth/register", json({ email: address, password: PASSWORD }));

  assert.equal((await app.request("/api/auth/login", json({ email: address, password: PASSWORD }))).status, 200);

  const wrong = await app.request("/api/auth/login", json({ email: address, password: `${PASSWORD}-nope` }));
  assert.equal(wrong.status, 401);
  // The same answer as an unknown address, so responses cannot enumerate users.
  const unknown = await app.request("/api/auth/login", json({ email: email(), password: PASSWORD }));
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
});

test("/me reflects the session cookie and nothing else", describeDb, async () => {
  const app = createApp();
  const address = email();
  const registered = await app.request("/api/auth/register", json({ email: address, password: PASSWORD }));
  const cookie = (registered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  const me = await app.request("/api/auth/me", { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json() as { email: string }).email, address.toLowerCase());

  assert.equal((await app.request("/api/auth/me")).status, 401);
});

test("a forged session cookie is rejected", describeDb, async () => {
  const app = createApp();
  const forged = await app.request("/api/auth/me", {
    headers: { cookie: `triptrack_session=${crypto.randomUUID()}.not-a-real-signature` },
  });
  assert.equal(forged.status, 401);
});

test("validation rejects a short password and a malformed email", describeDb, async () => {
  const app = createApp();
  assert.equal((await app.request("/api/auth/register", json({ email: email(), password: "short" }))).status, 400);
  assert.equal((await app.request("/api/auth/register", json({ email: "not-an-email", password: PASSWORD }))).status, 400);
});

test("an unknown /api path answers as an API, not with the SPA", describeDb, async () => {
  const res = await createApp().request("/api/nope");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
});
