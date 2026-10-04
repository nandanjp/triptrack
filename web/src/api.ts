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

export type ItineraryLocation = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  dayCount: number;
};

export type EntryKind = "activity" | "meal" | "place";
export type EntryStatus = "planned" | "done" | "skipped" | "cancelled";

export type Entry = {
  id: string;
  kind: EntryKind;
  title: string;
  startsAt: string | null;
  status: EntryStatus;
  notes: string | null;
  replacedByEntryId: string | null;
  placeId: string | null;
  placeName: string | null;
  attendees: { participantId: string; displayName: string }[];
};

export type BookingKind = "lodging" | "transit" | "event";
export type BookingStatus = "booked" | "cancelled" | "refunded";

export type Booking = {
  id: string;
  kind: BookingKind;
  title: string;
  provider: string | null;
  confirmationCode: string | null;
  startsAt: string;
  endsAt: string | null;
  locationId: string | null;
  status: BookingStatus;
  notes: string | null;
  /** Days actually using it — may be fewer than the nights paid for. */
  usedDayCount: number;
};

export type NewBooking = {
  kind: BookingKind;
  title: string;
  provider?: string | null;
  confirmationCode?: string | null;
  startsAt: string;
  endsAt?: string | null;
};

export type Day = {
  id: string;
  dayNumber: number;
  date: string | null;
  notes: string | null;
  locations: { id: string; name: string }[];
  lodging: { id: string; title: string; status: BookingStatus } | null;
  bookings: { id: string; kind: BookingKind; title: string; status: BookingStatus }[];
  entries: Entry[];
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

  locations: (tripId: string): Promise<ItineraryLocation[]> =>
    call<ItineraryLocation[]>(`/api/trips/${tripId}/locations`),
  addLocation: (tripId: string, name: string): Promise<ItineraryLocation> =>
    call(`/api/trips/${tripId}/locations`, { method: "POST", body: JSON.stringify({ name }) }),
  removeLocation: (tripId: string, locationId: string): Promise<unknown> =>
    call(`/api/trips/${tripId}/locations/${locationId}`, { method: "DELETE" }),

  days: (tripId: string): Promise<Day[]> => call<Day[]>(`/api/trips/${tripId}/days`),
  addDay: (
    tripId: string,
    day: { date?: string | null; locationIds?: string[]; atDayNumber?: number },
  ): Promise<Day> =>
    call(`/api/trips/${tripId}/days`, { method: "POST", body: JSON.stringify(day) }),
  patchDay: (
    tripId: string,
    dayId: string,
    patch: { date?: string | null; notes?: string | null; locationIds?: string[] },
  ): Promise<Day> =>
    call(`/api/trips/${tripId}/days/${dayId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeDay: (tripId: string, dayId: string): Promise<unknown> =>
    call(`/api/trips/${tripId}/days/${dayId}`, { method: "DELETE" }),
  shiftDays: (tripId: string, byDays: number): Promise<unknown> =>
    call(`/api/trips/${tripId}/days/shift`, { method: "POST", body: JSON.stringify({ byDays }) }),

  addEntry: (
    tripId: string,
    dayId: string,
    entry: { kind: EntryKind; title: string; startsAt?: string | null; status?: EntryStatus },
  ): Promise<Entry> =>
    call(`/api/trips/${tripId}/days/${dayId}/entries`, { method: "POST", body: JSON.stringify(entry) }),
  setEntryStatus: (
    tripId: string,
    entryId: string,
    status: EntryStatus,
    replacedByEntryId?: string | null,
  ): Promise<Entry> =>
    call(`/api/trips/${tripId}/entries/${entryId}/status`, {
      method: "POST",
      body: JSON.stringify({ status, ...(replacedByEntryId === undefined ? {} : { replacedByEntryId }) }),
    }),
  removeEntry: (tripId: string, entryId: string): Promise<unknown> =>
    call(`/api/trips/${tripId}/entries/${entryId}`, { method: "DELETE" }),

  bookings: (tripId: string): Promise<Booking[]> => call<Booking[]>(`/api/trips/${tripId}/bookings`),
  addBooking: (tripId: string, booking: NewBooking): Promise<Booking> =>
    call(`/api/trips/${tripId}/bookings`, { method: "POST", body: JSON.stringify(booking) }),
  setBookingStatus: (tripId: string, bookingId: string, status: BookingStatus): Promise<Booking> =>
    call(`/api/trips/${tripId}/bookings/${bookingId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  removeBooking: (tripId: string, bookingId: string): Promise<unknown> =>
    call(`/api/trips/${tripId}/bookings/${bookingId}`, { method: "DELETE" }),

  setDayLodging: (tripId: string, dayId: string, bookingId: string | null): Promise<unknown> =>
    call(`/api/trips/${tripId}/days/${dayId}/lodging`, { method: "PUT", body: JSON.stringify({ bookingId }) }),
  setDayBookings: (tripId: string, dayId: string, bookingIds: string[]): Promise<unknown> =>
    call(`/api/trips/${tripId}/days/${dayId}/bookings`, { method: "PUT", body: JSON.stringify({ bookingIds }) }),

  renameParticipant: (tripId: string, participantId: string, displayName: string): Promise<Participant> =>
    call(`/api/trips/${tripId}/participants/${participantId}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    }),
};
