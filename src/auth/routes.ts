import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { isUniqueViolation } from "../db/errors.ts";
import { users } from "../db/schema.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { currentUserId, endSession, startSession } from "./session.ts";

/**
 * TypeScript is erased at runtime, so request bodies are validated rather than
 * trusted. ADR-0003 treats this as load-bearing, not ceremony.
 */
const credentials = z.object({
  email: z.string().trim().min(3).max(320).email(),
  // Long enough to matter, bounded so scrypt cannot be used as a CPU sink.
  password: z.string().min(12).max(200),
});

/** Case- and whitespace-insensitive, so one address cannot register twice. */
const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export const authRoutes = new Hono()
  .post("/register", zValidator("json", credentials), async (c) => {
    const { email, password } = c.req.valid("json");
    const passwordHash = await hashPassword(password);

    try {
      const [user] = await getDb()
        .insert(users)
        .values({ email: normaliseEmail(email), passwordHash })
        .returning({ id: users.id, email: users.email });

      if (user === undefined) return c.json({ error: "could not create account" }, 500);

      await startSession(c, user.id);
      return c.json(user, 201);
    } catch (error: unknown) {
      if (isUniqueViolation(error, "users_email_unique")) {
        return c.json({ error: "that email is already registered" }, 409);
      }
      throw error;
    }
  })

  .post("/login", zValidator("json", credentials), async (c) => {
    const { email, password } = c.req.valid("json");

    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, normaliseEmail(email)))
      .limit(1);

    // One message and one code for both a missing account and a wrong
    // password, so the response cannot be used to enumerate addresses.
    const ok = user !== undefined && (await verifyPassword(password, user.passwordHash));
    if (!ok || user === undefined) return c.json({ error: "invalid credentials" }, 401);

    await startSession(c, user.id);
    return c.json({ id: user.id, email: user.email });
  })

  .post("/logout", (c) => {
    endSession(c);
    return c.json({ status: "signed out" });
  })

  .get("/me", async (c) => {
    const userId = await currentUserId(c);
    if (userId === undefined) return c.json({ error: "not authenticated" }, 401);

    const [user] = await getDb()
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // A valid cookie for a deleted account: clear it rather than 500.
    if (user === undefined) {
      endSession(c);
      return c.json({ error: "not authenticated" }, 401);
    }

    return c.json(user);
  });
