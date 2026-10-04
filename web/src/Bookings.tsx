import { useEffect, useState } from "react";
import { api, type Booking, type BookingKind, type NewBooking } from "./api.ts";

const KIND_LABEL: Record<BookingKind, string> = {
  lodging: "Stay",
  transit: "Travel",
  event: "Booked event",
};

const ORDER: BookingKind[] = ["lodging", "transit", "event"];

const when = (booking: Booking): string => {
  const start = booking.startsAt.slice(0, 16).replace("T", " ");
  if (booking.endsAt === null) return start;
  const end = booking.endsAt.slice(0, 16).replace("T", " ");
  // Same calendar day: only the end time is worth repeating.
  return booking.startsAt.slice(0, 10) === booking.endsAt.slice(0, 10)
    ? `${start} – ${end.slice(11)}`
    : `${start} → ${end}`;
};

/** Nights paid for, from the booking's own range. */
const nightsBooked = (booking: Booking): number | null => {
  if (booking.kind !== "lodging" || booking.endsAt === null) return null;
  const ms = new Date(booking.endsAt).getTime() - new Date(booking.startsAt).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
};

export function Bookings({
  tripId,
  version,
  onChange,
}: {
  tripId: string;
  /** Bumped when a day's lodging changes, which moves usedDayCount. */
  version: number;
  onChange: () => void;
}) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewBooking>({ kind: "lodging", title: "", startsAt: "" });

  const load = () => {
    api
      .bookings(tripId)
      .then(setBookings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(load, [tripId, version]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      // Day cards show lodging and travel, so they need refreshing too.
      onChange();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (bookings === null) return <p>…</p>;

  return (
    <section>
      <h3 style={{ fontSize: "1em" }}>Bookings</h3>
      <p style={{ color: "#666", fontSize: ".9em", marginTop: 0 }}>
        Stays, travel and anything prebooked. Assign them to days below — what was paid for and
        what got used are allowed to differ.
      </p>

      {ORDER.filter((kind) => bookings.some((b) => b.kind === kind)).map((kind) => (
        <div key={kind} style={{ marginBottom: "1rem" }}>
          <strong style={{ fontSize: ".9em", color: "#555" }}>{KIND_LABEL[kind]}</strong>
          <ul style={{ listStyle: "none", padding: 0, margin: ".25rem 0 0", display: "grid", gap: ".4rem" }}>
            {bookings
              .filter((b) => b.kind === kind)
              .map((booking) => {
                const nights = nightsBooked(booking);
                const overbooked = nights !== null && booking.usedDayCount > 0 && booking.usedDayCount < nights;
                return (
                  <li
                    key={booking.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 6,
                      padding: ".5rem .75rem",
                      opacity: booking.status === "booked" ? 1 : 0.6,
                    }}
                  >
                    <div>
                      <strong style={{ textDecoration: booking.status === "cancelled" ? "line-through" : "none" }}>
                        {booking.title}
                      </strong>
                      {booking.status !== "booked" && (
                        <small style={{ color: "#b00" }}> · {booking.status}</small>
                      )}
                    </div>
                    <div style={{ color: "#666", fontSize: ".85em" }}>
                      {when(booking)}
                      {booking.provider !== null && ` · ${booking.provider}`}
                      {booking.confirmationCode !== null && ` · ${booking.confirmationCode}`}
                    </div>
                    {overbooked && (
                      // Information, not a correction: booking long and using
                      // briefly is a legitimate thing to have done.
                      <small style={{ color: "#a60" }}>
                        {nights} nights booked, {booking.usedDayCount} assigned
                      </small>
                    )}
                    <div style={{ fontSize: ".8em", marginTop: ".3rem" }}>
                      {booking.status === "booked" && (
                        <button type="button" onClick={() => act(() => api.setBookingStatus(tripId, booking.id, "cancelled"))}>
                          mark cancelled
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => act(() => api.removeBooking(tripId, booking.id))}
                        style={{ color: "#b00" }}
                      >
                        delete
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}

      {bookings.length === 0 && <p style={{ color: "#666" }}>Nothing booked yet.</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api.addBooking(tripId, {
              ...draft,
              startsAt: new Date(draft.startsAt).toISOString(),
              endsAt: draft.endsAt == null || draft.endsAt === "" ? null : new Date(draft.endsAt).toISOString(),
            });
            setDraft({ kind: draft.kind, title: "", startsAt: "" });
          });
        }}
        style={{ display: "grid", gap: ".4rem", maxWidth: "24rem", marginTop: ".5rem" }}
      >
        <div style={{ display: "flex", gap: ".4rem" }}>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as BookingKind })}>
            {ORDER.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <input
            placeholder={draft.kind === "lodging" ? "Seoul apartment" : "YYZ → ICN"}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
            style={{ flex: 1 }}
          />
        </div>
        <label style={{ fontSize: ".85em", color: "#555" }}>
          {draft.kind === "lodging" ? "Check in" : "Departs"}
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
            required
          />
        </label>
        <label style={{ fontSize: ".85em", color: "#555" }}>
          {draft.kind === "lodging" ? "Check out (optional)" : "Arrives (optional)"}
          <input
            type="datetime-local"
            value={draft.endsAt ?? ""}
            onChange={(e) => setDraft({ ...draft, endsAt: e.target.value === "" ? null : e.target.value })}
          />
        </label>
        <div style={{ display: "flex", gap: ".4rem" }}>
          <input
            placeholder="Provider (optional)"
            value={draft.provider ?? ""}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value === "" ? null : e.target.value })}
            style={{ flex: 1 }}
          />
          <input
            placeholder="Confirmation (optional)"
            value={draft.confirmationCode ?? ""}
            onChange={(e) => setDraft({ ...draft, confirmationCode: e.target.value === "" ? null : e.target.value })}
            style={{ flex: 1 }}
          />
        </div>
        <button type="submit" disabled={draft.title.trim() === "" || draft.startsAt === ""}>
          Add booking
        </button>
      </form>

      {error !== null && <p style={{ color: "#b00" }}>{error}</p>}
    </section>
  );
}
