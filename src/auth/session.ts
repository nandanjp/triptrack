import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { publicScheme, sessionSecret } from "../config.ts";

const COOKIE = "triptrack_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * A signed cookie carrying the user id, with no server-side session table.
 * The trade is deliberate: there is nothing to revoke a single stolen cookie
 * with, short of rotating SESSION_SECRET and logging everyone out — which
 * ADR-0005 already records as a consequence. A session table is an additive
 * change if that ever stops being acceptable.
 */
export async function startSession(c: Context, userId: string): Promise<void> {
  await setSignedCookie(c, COOKIE, userId, sessionSecret(), {
    httpOnly: true,
    // Cloudflare terminates TLS, so the browser leg is https even though
    // cloudflared forwards plain HTTP to Traefik.
    secure: publicScheme() === "https",
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function endSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Returns the signed-in user's id, or undefined if the cookie is absent or forged. */
export async function currentUserId(c: Context): Promise<string | undefined> {
  const value = await getSignedCookie(c, sessionSecret(), COOKIE);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export type AuthenticatedEnv = { Variables: { userId: string } };

/** Guards routes that require a signed-in account. */
export const requireSession = (): MiddlewareHandler<AuthenticatedEnv> => async (c, next) => {
  const userId = await currentUserId(c);
  if (userId === undefined) return c.json({ error: "not authenticated" }, 401);
  c.set("userId", userId);
  await next();
};
