import { useEffect, useState } from "react";
import { api, type Day, type Entry, type EntryKind, type ItineraryLocation } from "./api.ts";

const KIND_LABEL: Record<EntryKind, string> = {
  activity: "Activity",
  meal: "Meal",
  place: "Place",
};

/** Struck through once it did not happen, so the plan stays readable. */
const entryStyle = (entry: Entry): React.CSSProperties =>
  entry.status === "skipped" || entry.status === "cancelled"
    ? { textDecoration: "line-through", color: "#999" }
    : {};

const STATUS_MARK: Record<Entry["status"], string> = {
  planned: "○",
  done: "●",
  skipped: "⤼",
  cancelled: "✕",
};

export function Itinerary({
  tripId,
  participantCount,
}: {
  tripId: string;
  /** Attendee names are shown only when a day's entry is narrower than this. */
  participantCount: number;
}) {
  const [days, setDays] = useState<Day[] | null>(null);
  const [locations, setLocations] = useState<ItineraryLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newLocation, setNewLocation] = useState("");
  const [newDayDate, setNewDayDate] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { title: string; kind: EntryKind; startsAt: string }>>({});

  const load = () => {
    Promise.all([api.days(tripId), api.locations(tripId)])
      .then(([d, l]) => {
        setDays(d);
        setLocations(l);
      })
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

  const draftFor = (dayId: string) =>
    drafts[dayId] ?? { title: "", kind: "activity" as EntryKind, startsAt: "" };

  if (days === null) return <p>…</p>;

  return (
    <section>
      <h3 style={{ fontSize: "1em" }}>Where</h3>
      <p style={{ margin: 0 }}>
        {locations.length === 0 ? (
          <span style={{ color: "#666" }}>No areas yet. Seoul, Busan, Jeju — rough is fine.</span>
        ) : (
          locations.map((l) => (
            <span key={l.id} style={{ marginRight: ".75rem" }}>
              {l.name}{" "}
              {/* Derived by counting days, never an allocation you must honour. */}
              <small style={{ color: "#888" }}>
                {l.dayCount} {l.dayCount === 1 ? "day" : "days"}
              </small>{" "}
              {l.dayCount === 0 && (
                <button
                  type="button"
                  onClick={() => act(() => api.removeLocation(tripId, l.id))}
                  style={{ background: "none", border: "none", color: "#b00", cursor: "pointer" }}
                  title="Remove"
                >
                  ×
                </button>
              )}
            </span>
          ))
        )}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api.addLocation(tripId, newLocation);
            setNewLocation("");
          });
        }}
        style={{ display: "flex", gap: ".5rem", margin: ".5rem 0 1.5rem", maxWidth: "20rem" }}
      >
        <input placeholder="Add an area" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} required style={{ flex: 1 }} />
        <button type="submit" disabled={newLocation.trim() === ""}>Add</button>
      </form>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: "1em", margin: 0 }}>Day by day</h3>
        {days.length > 0 && (
          <span style={{ fontSize: ".85em" }}>
            Trip moved?{" "}
            <button type="button" onClick={() => act(() => api.shiftDays(tripId, -7))}>−1 week</button>{" "}
            <button type="button" onClick={() => act(() => api.shiftDays(tripId, -1))}>−1 day</button>{" "}
            <button type="button" onClick={() => act(() => api.shiftDays(tripId, 1))}>+1 day</button>{" "}
            <button type="button" onClick={() => act(() => api.shiftDays(tripId, 7))}>+1 week</button>
          </span>
        )}
      </div>

      {days.length === 0 && <p style={{ color: "#666" }}>No days yet. Add the first one below.</p>}

      <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: "1rem" }}>
        {days.map((day) => (
          <li key={day.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: ".75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <strong>
                Day {day.dayNumber}
                {day.date !== null && <span style={{ fontWeight: 400, color: "#666" }}> · {day.date}</span>}
              </strong>
              <span style={{ fontSize: ".85em" }}>
                <button type="button" onClick={() => act(() => api.addDay(tripId, { atDayNumber: day.dayNumber }))} title="Insert a day here">
                  insert before
                </button>{" "}
                <button type="button" onClick={() => act(() => api.removeDay(tripId, day.id))} style={{ color: "#b00" }}>
                  delete day
                </button>
              </span>
            </div>

            {day.locations.length > 0 && (
              <div style={{ color: "#666", fontSize: ".9em" }}>
                {day.locations.map((l) => l.name).join(" → ")}
              </div>
            )}

            <ul style={{ listStyle: "none", padding: 0, margin: ".5rem 0 0", display: "grid", gap: ".3rem" }}>
              {day.entries.map((entry) => (
                <li key={entry.id} style={{ display: "flex", gap: ".5rem", alignItems: "baseline" }}>
                  <span title={entry.status}>{STATUS_MARK[entry.status]}</span>
                  <span style={{ color: "#888", fontVariantNumeric: "tabular-nums", minWidth: "3.2rem" }}>
                    {entry.startsAt?.slice(0, 5) ?? ""}
                  </span>
                  <span style={{ flex: 1, ...entryStyle(entry) }}>
                    {entry.title}
                    <small style={{ color: "#aaa" }}> · {KIND_LABEL[entry.kind]}</small>
                    {entry.placeName !== null && <small style={{ color: "#888" }}> · {entry.placeName}</small>}
                    {/* Only worth saying when the group split up. */}
                    {entry.attendees.length > 0 && entry.attendees.length < participantCount && (
                      <small style={{ color: "#888" }}> · {entry.attendees.map((a) => a.displayName).join(", ")}</small>
                    )}
                  </span>
                  <span style={{ fontSize: ".8em", whiteSpace: "nowrap" }}>
                    {entry.status !== "done" && (
                      <button type="button" onClick={() => act(() => api.setEntryStatus(tripId, entry.id, "done"))}>done</button>
                    )}
                    {entry.status === "planned" && (
                      <button type="button" onClick={() => act(() => api.setEntryStatus(tripId, entry.id, "skipped"))}>skip</button>
                    )}
                    <button type="button" onClick={() => act(() => api.removeEntry(tripId, entry.id))} style={{ color: "#b00" }}>×</button>
                  </span>
                </li>
              ))}
            </ul>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const draft = draftFor(day.id);
                void act(async () => {
                  await api.addEntry(tripId, day.id, {
                    kind: draft.kind,
                    title: draft.title,
                    startsAt: draft.startsAt === "" ? null : draft.startsAt,
                  });
                  setDrafts((prev) => ({ ...prev, [day.id]: { title: "", kind: draft.kind, startsAt: "" } }));
                });
              }}
              style={{ display: "flex", gap: ".4rem", marginTop: ".5rem", flexWrap: "wrap" }}
            >
              <select
                value={draftFor(day.id).kind}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [day.id]: { ...draftFor(day.id), kind: e.target.value as EntryKind } }))}
              >
                {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
              <input
                type="time"
                value={draftFor(day.id).startsAt}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [day.id]: { ...draftFor(day.id), startsAt: e.target.value } }))}
              />
              <input
                placeholder="What are you doing?"
                value={draftFor(day.id).title}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [day.id]: { ...draftFor(day.id), title: e.target.value } }))}
                required
                style={{ flex: 1, minWidth: "10rem" }}
              />
              <button type="submit" disabled={draftFor(day.id).title.trim() === ""}>Add</button>
            </form>
          </li>
        ))}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api.addDay(tripId, { date: newDayDate === "" ? null : newDayDate });
            setNewDayDate("");
          });
        }}
        style={{ display: "flex", gap: ".5rem", marginTop: "1rem", alignItems: "center", flexWrap: "wrap" }}
      >
        <input type="date" value={newDayDate} onChange={(e) => setNewDayDate(e.target.value)} />
        <button type="submit">Add day</button>
        <small style={{ color: "#888" }}>A date is optional — an unscheduled trip still has an itinerary.</small>
      </form>

      {error !== null && <p style={{ color: "#b00" }}>{error}</p>}
    </section>
  );
}
