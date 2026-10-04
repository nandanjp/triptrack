import { test } from "node:test";
import assert from "node:assert/strict";
import { INVITE_TTL_DAYS, hashToken, inviteState, issueToken } from "../src/trips/invite-token.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const valid = { revokedAt: null, claimedAt: null, expiresAt: new Date(Date.now() + DAY_MS) };

test("issued tokens are unique and not stored in the clear", () => {
  const a = issueToken();
  const b = issueToken();
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.tokenHash, b.tokenHash);
  assert.notEqual(a.tokenHash, a.token, "the hash must not be the token");
  assert.equal(a.tokenHash, hashToken(a.token));
});

test("tokens expire after the configured window", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  const { expiresAt } = issueToken(now);
  assert.equal(expiresAt.getTime() - now.getTime(), INVITE_TTL_DAYS * DAY_MS);
});

test("a fresh invite is valid", () => {
  assert.equal(inviteState(valid), "valid");
});

test("expiry is detected", () => {
  assert.equal(
    inviteState({ ...valid, expiresAt: new Date(Date.now() - 1000) }),
    "expired",
  );
});

test("revoked outranks claimed and expired, because it is the more useful answer", () => {
  const revoked = new Date();
  assert.equal(inviteState({ ...valid, revokedAt: revoked }), "revoked");
  assert.equal(inviteState({ ...valid, revokedAt: revoked, claimedAt: new Date() }), "revoked");
  assert.equal(
    inviteState({ revokedAt: revoked, claimedAt: new Date(), expiresAt: new Date(0) }),
    "revoked",
  );
});

test("claimed outranks expired", () => {
  assert.equal(
    inviteState({ revokedAt: null, claimedAt: new Date(), expiresAt: new Date(0) }),
    "claimed",
  );
});

test("expiry is exclusive at the boundary, so an invite is not valid at its own deadline", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(inviteState({ ...valid, expiresAt: now }, now), "expired");
});
