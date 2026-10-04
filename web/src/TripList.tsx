import { useEffect, useState } from "react";
import { api, type NewTrip, type TripSummary } from "./api.ts";
import { navigate } from "./routing.ts";

const dateRange = (trip: TripSummary): string => {
  if (trip.startDate === null) return "no dates yet";
  return trip.endDate === null ? trip.startDate : `${trip.startDate} → ${trip.endDate}`;
};

export function TripList() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewTrip>({ name: "" });
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .trips()
      .then(setTrips)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(load, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createTrip({
        name: draft.name,
        startDate: draft.startDate ?? null,
        endDate: draft.endDate ?? null,
        ...(draft.homeCurrency === undefined ? {} : { homeCurrency: draft.homeCurrency }),
      });
      setDraft({ name: "" });
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Trips</h2>

      {trips === null ? (
        <p>…</p>
      ) : trips.length === 0 ? (
        <p style={{ color: "#666" }}>No trips yet. Name one below — dates can come later.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: ".5rem" }}>
          {trips.map((trip) => (
            <li key={trip.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: ".75rem" }}>
              <button
                type="button"
                onClick={() => navigate(`/trips/${trip.id}`)}
                style={{ background: "none", border: "none", font: "inherit", color: "#06c", cursor: "pointer", padding: 0 }}
              >
                <strong>{trip.name}</strong>
              </button>
              <div style={{ color: "#666", fontSize: ".9em" }}>
                {dateRange(trip)} · {trip.status} · {trip.homeCurrency} · {trip.role}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} style={{ display: "grid", gap: ".5rem", maxWidth: "22rem", marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1em" }}>New trip</h3>
        <input
          placeholder="Korea"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          required
        />
        <label style={{ fontSize: ".9em", color: "#555" }}>
          Start (optional)
          <input
            type="date"
            value={draft.startDate ?? ""}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value || null })}
          />
        </label>
        <label style={{ fontSize: ".9em", color: "#555" }}>
          End (optional)
          <input
            type="date"
            value={draft.endDate ?? ""}
            onChange={(e) => setDraft({ ...draft, endDate: e.target.value || null })}
          />
        </label>
        <button type="submit" disabled={busy || draft.name.trim() === ""}>
          {busy ? "…" : "Create trip"}
        </button>
        {error !== null && <p style={{ color: "#b00", margin: 0 }}>{error}</p>}
      </form>
    </section>
  );
}
