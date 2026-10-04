export type Account = { id: string; email: string };

/** The API answers JSON for every /api path, including errors. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed (${res.status})`;
    throw new Error(message);
  }

  return body as T;
}

export const api = {
  me: (): Promise<Account> => call<Account>("/api/auth/me"),
  register: (email: string, password: string): Promise<Account> =>
    call<Account>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string): Promise<Account> =>
    call<Account>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: (): Promise<unknown> => call("/api/auth/logout", { method: "POST" }),
};
