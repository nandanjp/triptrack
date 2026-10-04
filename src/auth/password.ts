import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * scrypt from node:crypto rather than bcrypt or argon2: both are native
 * modules, which esbuild cannot inline into the single-file bundle the image
 * ships (ADR-0003). scrypt is a memory-hard KDF and an appropriate choice.
 *
 * N=16384, r=8 needs 128*N*r = 16MB, which fits Node's 32MB scrypt default.
 */
const COST = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, COST, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

/**
 * Self-describing: the cost parameters travel with the hash, so they can be
 * raised later without invalidating existing passwords.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt);
  return [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64 ?? "", "base64");
  const expected = Buffer.from(keyB64 ?? "", "base64");

  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

  // Lengths must match before timingSafeEqual, which throws otherwise.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
