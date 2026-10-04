import { useEffect, useState } from "react";
import { formatMinor } from "../../src/expenses/money.ts";
import { api, type SettlementView } from "./api.ts";

export function Settlement({
  tripId,
  isOwner,
  version,
  onChange,
}: {
  tripId: string;
  isOwner: boolean;
  version: number;
  onChange: () => void;
}) {
  const [view, setView] = useState<SettlementView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .settlement(tripId)
      .then(setView)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(load, [tripId, version]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      onChange();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (view === null) return <p>…</p>;

  const nameFor = (id: string) => view.participants.find((p) => p.id === id)?.displayName ?? "someone";
  const settled = view.settledAt !== null;

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: "1em", margin: 0 }}>Settling up</h3>
        {isOwner && (
          settled ? (
            <button type="button" onClick={() => act(() => api.reopenTrip(tripId))}>
              Reopen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => act(() => api.settleTrip(tripId))}
              // Refused server-side while anyone is owed; disabled here so the
              // refusal is not the first thing you learn.
              disabled={view.outstanding}
              title={view.outstanding ? "Record the remaining payments first" : "Lock the money"}
            >
              Mark settled
            </button>
          )
        )}
      </div>

      {settled && (
        <p style={{ color: "#070", margin: ".25rem 0" }}>
          Settled on {view.settledAt?.slice(0, 10)}. Expenses are read-only — reopen to change them.
        </p>
      )}

      {view.perCurrency.length === 0 && <p style={{ color: "#666" }}>No shared spending yet.</p>}

      {view.perCurrency.map((group) => (
        <div key={group.currency} style={{ marginBottom: "1rem" }}>
          {view.perCurrency.length > 1 && (
            <strong style={{ fontSize: ".9em", color: "#555" }}>{group.currency}</strong>
          )}

          {group.inconsistency !== null && (
            // Should be impossible: shares always sum to their total. Shown
            // rather than hidden, because silence would be worse.
            <p style={{ color: "#b00" }}>Balances do not add up ({group.inconsistency}).</p>
          )}

          {group.balances.length === 0 ? (
            <p style={{ color: "#070", margin: ".25rem 0" }}>Everyone is square.</p>
          ) : (
            <>
              <ul style={{ listStyle: "none", padding: 0, margin: ".25rem 0", fontSize: ".9em" }}>
                {group.balances.map((b) => (
                  <li key={b.participantId}>
                    {nameFor(b.participantId)}{" "}
                    {b.netMinor > 0 ? (
                      <span style={{ color: "#070" }}>is owed {formatMinor(b.netMinor, group.currency)}</span>
                    ) : (
                      <span style={{ color: "#a60" }}>owes {formatMinor(-b.netMinor, group.currency)}</span>
                    )}
                  </li>
                ))}
              </ul>

              {group.plan.length > 0 && (
                <div>
                  <small style={{ color: "#666" }}>
                    {/* At most one payment fewer than there are people. */}
                    {group.plan.length === 1 ? "One payment clears this:" : `${group.plan.length} payments clear this:`}
                  </small>
                  <ul style={{ listStyle: "none", padding: 0, margin: ".25rem 0", display: "grid", gap: ".3rem" }}>
                    {group.plan.map((t, i) => (
                      <li key={`${t.fromParticipantId}-${t.toParticipantId}-${i}`} style={{ display: "flex", gap: ".5rem", alignItems: "baseline" }}>
                        <span style={{ flex: 1 }}>
                          <strong>{nameFor(t.fromParticipantId)}</strong> pays{" "}
                          <strong>{nameFor(t.toParticipantId)}</strong>{" "}
                          {formatMinor(t.amountMinor, group.currency)}
                        </span>
                        {!settled && (
                          <button
                            type="button"
                            onClick={() => act(() => api.recordPayment(tripId, { ...t, currency: group.currency }))}
                          >
                            mark paid
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {view.recorded.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: ".9em", color: "#555" }}>
            {view.recorded.length} payment{view.recorded.length === 1 ? "" : "s"} recorded
          </summary>
          <ul style={{ listStyle: "none", padding: 0, fontSize: ".9em" }}>
            {view.recorded.map((r) => (
              <li key={r.id}>
                {r.settledOn} · {nameFor(r.fromParticipantId)} → {nameFor(r.toParticipantId)}{" "}
                {formatMinor(r.amountMinor, r.currency)}
                {!settled && (
                  <button
                    type="button"
                    onClick={() => act(() => api.unrecordPayment(tripId, r.id))}
                    style={{ color: "#b00", fontSize: ".9em" }}
                  >
                    undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error !== null && <p style={{ color: "#b00" }}>{error}</p>}
    </section>
  );
}
