import { useEffect, useState } from "react";
import { api, type TripDetail as Trip } from "./api.ts";
import { Bookings } from "./Bookings.tsx";
import { Itinerary } from "./Itinerary.tsx";
import { navigate } from "./routing.ts";

export function TripDetail({ tripId }: { tripId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seatName, setSeatName] = useState("");
  /** Which seat is being renamed inline, and to what. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  /** Bumped so siblings reload when an edit here changes what they show. */
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  /** Keyed by participant id. The token is shown once and never refetchable. */
  const [links, setLinks] = useState<Record<string, string>>({});

  const load = () => {
    api
      .trip(tripId)
      .then(setTrip)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(load, [tripId]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error !== null && trip === null) {
    return (
      <section>
        <p style={{ color: "#b00" }}>{error}</p>
        <button type="button" onClick={() => navigate("/")}>
          Back to trips
        </button>
      </section>
    );
  }

  if (trip === null) return <p>…</p>;

  const isOwner = trip.role === "owner";

  return (
    <section>
      <button
        type="button"
        onClick={() => navigate("/")}
        style={{ background: "none", border: "none", color: "#06c", cursor: "pointer", padding: 0 }}
      >
        ← Trips
      </button>

      <h2 style={{ marginBottom: 0 }}>{trip.name}</h2>
      <p style={{ color: "#666", marginTop: ".25rem" }}>
        {trip.startDate ?? "no dates yet"}
        {trip.endDate !== null && ` → ${trip.endDate}`} · {trip.status} · {trip.homeCurrency}
      </p>

      <h3 style={{ fontSize: "1em" }}>Who's coming</h3>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: ".5rem" }}>
        {trip.participants.map((p) => (
          <li key={p.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: ".5rem .75rem" }}>
            {renaming?.id === p.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = renaming.value.trim();
                  setRenaming(null);
                  if (next !== "" && next !== p.displayName) {
                    void act(() => api.renameParticipant(trip.id, p.id, next));
                  }
                }}
                style={{ display: "inline-flex", gap: ".3rem" }}
              >
                <input
                  value={renaming.value}
                  onChange={(e) => setRenaming({ id: p.id, value: e.target.value })}
                  onBlur={() => setRenaming(null)}
                  autoFocus
                />
                <button type="submit">Save</button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setRenaming({ id: p.id, value: p.displayName })}
                title="Rename this seat"
                style={{ background: "none", border: "none", font: "inherit", fontWeight: 700, color: "#06c", cursor: "pointer", padding: 0 }}
              >
                {p.displayName}
              </button>
            )}{" "}
            <span style={{ color: "#888", fontSize: ".9em" }}>
              {p.role}
              {/* A seat without an account is the normal case, not an error. */}
              {!p.hasAccount && " · no account yet"}
            </span>

            {isOwner && !p.hasAccount && (
              <div style={{ marginTop: ".4rem", display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                <button type="button" onClick={() => act(async () => {
                  const { url } = await api.invite(trip.id, p.id);
                  setLinks((prev) => ({ ...prev, [p.id]: url }));
                })}>
                  Create invite link
                </button>
                <button type="button" onClick={() => act(() => api.removeParticipant(trip.id, p.id))}>
                  Remove
                </button>
              </div>
            )}

            {links[p.id] !== undefined && (
              <p style={{ marginBottom: 0 }}>
                <input
                  readOnly
                  value={links[p.id]}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: ".85em" }}
                />
                <small style={{ color: "#888" }}>
                  Copy this now — it is shown once, and anyone holding it can join as{" "}
                  {p.displayName}.
                </small>
              </p>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.addParticipant(trip.id, seatName);
              setSeatName("");
            });
          }}
          style={{ display: "flex", gap: ".5rem", maxWidth: "22rem" }}
        >
          <input
            placeholder="Add someone by name"
            value={seatName}
            onChange={(e) => setSeatName(e.target.value)}
            required
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={seatName.trim() === ""}>
            Add
          </button>
        </form>
      )}

      {error !== null && <p style={{ color: "#b00" }}>{error}</p>}

      <hr style={{ margin: "2rem 0 1rem", border: 0, borderTop: "1px solid #eee" }} />
      <Bookings tripId={trip.id} version={version} onChange={bump} />

      <hr style={{ margin: "2rem 0 1rem", border: 0, borderTop: "1px solid #eee" }} />
      <Itinerary
        tripId={trip.id}
        participantCount={trip.participants.length}
        version={version}
        onChange={bump}
      />

      <p style={{ color: "#666", marginTop: "2rem" }}>Expenses arrive in step 6.</p>
    </section>
  );
}
