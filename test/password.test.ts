import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth/password.ts";

test("a password verifies against its own hash", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.ok(await verifyPassword("correct horse battery staple", hash));
});

test("a wrong password does not verify", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
});

test("the same password hashes differently each time", async () => {
  const [a, b] = await Promise.all([hashPassword("a-long-enough-secret"), hashPassword("a-long-enough-secret")]);
  assert.notEqual(a, b, "a per-password salt must make the hashes differ");
});

test("the hash carries its own cost parameters, so they can be raised later", async () => {
  const hash = await hashPassword("a-long-enough-secret");
  const [scheme, n, r, p] = hash.split("$");
  assert.equal(scheme, "scrypt");
  assert.deepEqual([n, r, p], ["16384", "8", "1"]);
});

test("a malformed stored hash is rejected rather than throwing", async () => {
  for (const bad of ["", "nonsense", "scrypt$1$2$3", "argon2$16384$8$1$c2FsdA==$a2V5"]) {
    assert.equal(await verifyPassword("a-long-enough-secret", bad), false, bad);
  }
});
