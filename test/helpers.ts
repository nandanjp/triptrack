import { createApp } from "../src/app.ts";

export type Session = { cookie: string; userId: string; email: string };

export const app = () => createApp();

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const authed = (cookie: string, method = "GET", body?: unknown): RequestInit => ({
  ...json(method, body),
  headers: { "content-type": "application/json", cookie },
});

/** Registers a throwaway account and returns its session cookie. */
export async function signUp(): Promise<Session> {
  const email = `user-${crypto.randomUUID()}@example.test`;
  const res = await createApp().request(
    "/api/auth/register",
    json("POST", { email, password: "a-sufficiently-long-password" }),
  );

  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status}`);

  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { id } = (await res.json()) as { id: string };
  return { cookie, userId: id, email };
}

/** Creates a trip owned by the given session and returns its id. */
export async function createTrip(session: Session, name = "Korea"): Promise<string> {
  const res = await createApp().request("/api/trips", authed(session.cookie, "POST", { name }));
  if (res.status !== 201) throw new Error(`trip create failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/**
 * Asserts a write was refused by a named database constraint.
 *
 * Drizzle wraps driver errors, so the constraint name lives on `.cause` and a
 * plain regex against the error message never matches — the same shape that
 * once turned a duplicate registration into a 500 (see src/db/errors.ts).
 */
export async function assertRefusedBy(
  constraint: string,
  write: () => Promise<unknown>,
): Promise<void> {
  try {
    await write();
  } catch (error: unknown) {
    const messages: string[] = [];
    for (let current: unknown = error, depth = 0; current != null && depth < 5; depth += 1) {
      if (typeof current !== "object") break;
      const candidate = current as { message?: unknown; constraint_name?: unknown; cause?: unknown };
      if (typeof candidate.message === "string") messages.push(candidate.message);
      if (typeof candidate.constraint_name === "string") messages.push(candidate.constraint_name);
      current = candidate.cause;
    }

    if (messages.some((m) => m.includes(constraint))) return;
    throw new Error(`expected ${constraint} to refuse the write, got: ${messages.join(" | ")}`);
  }

  throw new Error(`expected ${constraint} to refuse the write, but it succeeded`);
}
