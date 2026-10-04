import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniqueViolation } from "../src/db/errors.ts";

/**
 * Shapes taken from a real drizzle-orm 0.45 + postgres-js 3.4 failure: the
 * SQLSTATE sits on `.cause`, not on the error. Encoded here so a dependency
 * bump that moves it turns a test red instead of turning a 409 into a 500.
 */
const wrapped = (code: string, constraint?: string): unknown => ({
  name: "DrizzleQueryError",
  cause: { name: "PostgresError", code, constraint_name: constraint },
});

test("detects a unique violation wrapped by Drizzle", () => {
  assert.ok(isUniqueViolation(wrapped("23505", "users_email_unique")));
});

test("matches on constraint name when one is given", () => {
  const error = wrapped("23505", "users_email_unique");
  assert.ok(isUniqueViolation(error, "users_email_unique"));
  assert.equal(isUniqueViolation(error, "trips_slug_unique"), false);
});

test("ignores other database errors", () => {
  for (const code of ["23503", "23502", "42P01"]) {
    assert.equal(isUniqueViolation(wrapped(code, "whatever")), false, code);
  }
});

test("survives odd inputs without throwing", () => {
  for (const value of [undefined, null, "string", 42, {}, { cause: null }]) {
    assert.equal(isUniqueViolation(value), false);
  }
});

test("finds the code deeper in the cause chain", () => {
  const nested = { cause: { cause: { code: "23505", constraint_name: "users_email_unique" } } };
  assert.ok(isUniqueViolation(nested, "users_email_unique"));
});
