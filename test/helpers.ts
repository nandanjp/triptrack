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
