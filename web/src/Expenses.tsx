import { useEffect, useState } from "react";
import { formatMinor, parseAmount } from "../../src/expenses/money.ts";
import { api, type Expense, type ExpenseSummary, type Participant } from "./api.ts";

const CURRENCIES = ["CAD", "KRW", "JPY", "USD", "EUR", "GBP"];

type Draft = {
  description: string;
  amount: string;
  currency: string;
  paidByParticipantId: string;
  consumerIds: string[];
  isPrivate: boolean;
};

const Totals = ({ label, totals, hint }: { label: string; totals: { currency: string; totalMinor: number }[]; hint?: string }) => (
  <div>
    <strong style={{ fontSize: ".9em", color: "#555" }}>{label}</strong>
    {hint !== undefined && <small style={{ color: "#888" }}> · {hint}</small>}
    <div>
      {totals.length === 0 ? (
        <span style={{ color: "#888" }}>—</span>
      ) : (
        // One figure per currency rather than a single converted number: a
        // rate moving must not change what a past trip cost.
        totals.map((t) => (
          <span key={t.currency} style={{ marginRight: ".75rem", fontVariantNumeric: "tabular-nums" }}>
            {formatMinor(t.totalMinor, t.currency)}
          </span>
        ))
      )}
    </div>
  </div>
);

export function Expenses({
  tripId,
  participants,
  myParticipantId,
  version,
  onChange,
}: {
  tripId: string;
  participants: Participant[];
  myParticipantId: string | null;
  version: number;
  onChange: () => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    description: "",
    amount: "",
    currency: CURRENCIES[0] ?? "CAD",
    paidByParticipantId: myParticipantId ?? "",
    consumerIds: participants.map((p) => p.id),
    isPrivate: false,
  });

  const load = () => {
    Promise.all([api.expenses(tripId), api.expenseSummary(tripId)])
      .then(([e, s]) => {
        setExpenses(e);
        setSummary(s);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, [tripId, version]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      onChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseAmount(draft.amount, draft.currency);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    void act(async () => {
      await api.addExpense(tripId, {
        description: draft.description,
        amountMinor: parsed.amountMinor,
        currency: draft.currency,
        paidByParticipantId: draft.paidByParticipantId || undefined,
        isPrivate: draft.isPrivate,
        // A private expense has nobody to split with, so the list is omitted.
        ...(draft.isPrivate ? {} : { consumerIds: draft.consumerIds }),
      });
      setDraft({ ...draft, description: "", amount: "" });
    });
  };

  if (expenses === null || summary === null) return <p>…</p>;

  const nameFor = (id: string) => participants.find((p) => p.id === id)?.displayName ?? "someone";

  return (
    <section>
      <h3 style={{ fontSize: "1em" }}>Money</h3>

      <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <Totals label="Trip total" totals={summary.shared} hint="shared" />
        <Totals label="Your total" totals={summary.mine} hint="your share, plus your private spend" />
      </div>

      {expenses.length === 0 ? (
        <p style={{ color: "#666" }}>Nothing recorded yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: ".4rem" }}>
          {expenses.map((expense) => (
            <li key={expense.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: ".5rem .75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                <span>
                  {expense.description}
                  {expense.isPrivate && <small style={{ color: "#777" }}> · private</small>}
                </span>
                <strong style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {formatMinor(expense.amountMinor, expense.currency)}
                </strong>
              </div>
              <div style={{ color: "#666", fontSize: ".85em" }}>
                {/* Paid is not owed: the payer fronted it, the shares say who consumed it. */}
                {expense.paidByName} paid
                {expense.shares.length > 0 && (
                  <>
                    {" · "}
                    {expense.shares
                      .map((s) => `${s.displayName} ${formatMinor(s.amountMinor, expense.currency)}`)
                      .join(", ")}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => act(() => api.removeExpense(tripId, expense.id))}
                style={{ fontSize: ".8em", color: "#b00" }}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} style={{ display: "grid", gap: ".4rem", maxWidth: "26rem", marginTop: "1rem" }}>
        <div style={{ display: "flex", gap: ".4rem" }}>
          <input
            placeholder="What was it for?"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            required
            style={{ flex: 1 }}
          />
          <input
            placeholder="0.00"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            required
            inputMode="decimal"
            style={{ width: "6.5rem", textAlign: "right" }}
          />
          <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </div>

        <label style={{ fontSize: ".85em", color: "#555" }}>
          Paid by{" "}
          <select
            value={draft.paidByParticipantId}
            onChange={(e) => setDraft({ ...draft, paidByParticipantId: e.target.value })}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        </label>

        {!draft.isPrivate && (
          <div style={{ fontSize: ".85em", color: "#555" }}>
            Split between:{" "}
            {participants.map((p) => {
              const on = draft.consumerIds.includes(p.id);
              return (
                <label key={p.id} style={{ marginRight: ".6rem", whiteSpace: "nowrap" }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        consumerIds: on
                          ? draft.consumerIds.filter((id) => id !== p.id)
                          : [...draft.consumerIds, p.id],
                      })
                    }
                  />{" "}
                  {p.displayName}
                </label>
              );
            })}
            {draft.paidByParticipantId !== "" && !draft.consumerIds.includes(draft.paidByParticipantId) && (
              <small style={{ color: "#888" }}>
                {nameFor(draft.paidByParticipantId)} is owed the whole amount.
              </small>
            )}
          </div>
        )}

        <label style={{ fontSize: ".85em", color: "#555" }}>
          <input
            type="checkbox"
            checked={draft.isPrivate}
            onChange={(e) => setDraft({ ...draft, isPrivate: e.target.checked })}
          />{" "}
          Private — only you see this, and it stays out of the split
        </label>

        <button
          type="submit"
          disabled={draft.description.trim() === "" || draft.amount.trim() === "" || (!draft.isPrivate && draft.consumerIds.length === 0)}
        >
          Add expense
        </button>
      </form>

      {error !== null && <p style={{ color: "#b00" }}>{error}</p>}
    </section>
  );
}
