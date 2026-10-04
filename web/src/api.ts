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

export type TripSummary = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  homeCurrency: string;
  role: "owner" | "member";
};

export type Participant = {
  id: string;
  displayName: string;
  role: "owner" | "member";
  joinedOn: string | null;
  hasAccount: boolean;
};

export type TripDetail = TripSummary & { participants: Participant[] };

export type InvitePreview = {
  state: "valid" | "revoked" | "claimed" | "expired";
  tripName: string;
  seatName: string;
  signedIn: boolean;
};

export type NewTrip = {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  homeCurrency?: string;
};

export const api = {
  me: (): Promise<Account> => call<Account>("/api/auth/me"),
  register: (email: string, password: string): Promise<Account> =>
    call<Account>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string): Promise<Account> =>
    call<Account>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: (): Promise<unknown> => call("/api/auth/logout", { method: "POST" }),

  trips: (): Promise<TripSummary[]> => call<TripSummary[]>("/api/trips"),
  trip: (id: string): Promise<TripDetail> => call<TripDetail>(`/api/trips/${id}`),
  createTrip: (trip: NewTrip): Promise<TripSummary> =>
    call<TripSummary>("/api/trips", { method: "POST", body: JSON.stringify(trip) }),
  deleteTrip: (id: string): Promise<unknown> =>
    call(`/api/trips/${id}`, { method: "DELETE" }),

  addParticipant: (tripId: string, displayName: string): Promise<Participant> =>
    call<Participant>(`/api/trips/${tripId}/participants`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    }),
  removeParticipant: (tripId: string, participantId: string): Promise<unknown> =>
    call(`/api/trips/${tripId}/participants/${participantId}`, { method: "DELETE" }),

  // The plaintext token comes back only here; only its hash is stored.
  invite: (tripId: string, participantId: string): Promise<{ url: string; expiresAt: string }> =>
    call(`/api/trips/${tripId}/participants/${participantId}/invite`, { method: "POST" }),
  previewInvite: (token: string): Promise<InvitePreview> =>
    call<InvitePreview>(`/api/invites/${token}`),
  acceptInvite: (token: string): Promise<{ tripId: string }> =>
    call(`/api/invites/${token}/accept`, { method: "POST" }),
};
