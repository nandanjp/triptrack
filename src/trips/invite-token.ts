import { createHash, randomBytes } from "node:crypto";

/**
 * Invite tokens are bearer credentials (ADR-0005), so only a hash is stored.
 * A database leak then yields no working invites. The plaintext is returned to
 * the inviter once and never persisted.
 *
 * SHA-256 with no salt or KDF is deliberate here, unlike for passwords: the
 * token is 256 bits of CSPRNG output, so there is no guessable input space to
 * slow an attacker down over, and lookup has to be by exact hash.
 */
const TOKEN_BYTES = 32;

export const INVITE_TTL_DAYS = 14;

export type IssuedToken = { token: string; tokenHash: string; expiresAt: Date };

export function issueToken(now: Date = new Date()): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashToken(token), expiresAt };
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export type InviteState = "valid" | "revoked" | "claimed" | "expired";

/**
 * Order matters: a revoked invite reports as revoked even once expired, since
 * that is the more useful thing to tell someone.
 */
export function inviteState(
  invite: { revokedAt: Date | null; claimedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): InviteState {
  if (invite.revokedAt !== null) return "revoked";
  if (invite.claimedAt !== null) return "claimed";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}
