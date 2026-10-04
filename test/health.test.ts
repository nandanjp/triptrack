import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { beginDraining, resetReadiness } from "../src/readiness.ts";

beforeEach(resetReadiness);

test("/health reports the build version", async () => {
  const res = await createApp().request("/health");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; version: string };
  assert.equal(body.status, "ok");
  // "dev" from source; a sha- tag once bundled. Either way it must be present.
  assert.ok(body.version.length > 0);
});

test("/health/ready serves traffic until draining starts", async () => {
  const app = createApp();
  assert.equal((await app.request("/health/ready")).status, 200);

  beginDraining();

  const draining = await app.request("/health/ready");
  assert.equal(draining.status, 503);
  assert.equal(((await draining.json()) as { status: string }).status, "draining");
});

test("/health/live stays 200 while draining, so a draining pod is not killed", async () => {
  const app = createApp();
  beginDraining();
  assert.equal((await app.request("/health/live")).status, 200);
});
