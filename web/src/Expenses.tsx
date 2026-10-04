import { useEffect, useState } from "react";
import { EyeOff, Plus, Trash2 } from "lucide-react";
import { formatMinor, parseAmount } from "../../src/expenses/money.ts";
import { api, type CurrencyTotal, type Expense, type ExpenseSummary, type Participant } from "./api.ts";
import { Badge } from "@/ui/badge.tsx";
import { Button } from "@/ui/button.tsx";
import { Checkbox } from "@/ui/checkbox.tsx";
import { Dialog } from "@/ui/dialog.tsx";
import { Field } from "@/ui/field.tsx";
import { Input, Select } from "@/ui/input.tsx";
import { Empty, Panel, PanelHeader } from "@/ui/surface.tsx";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "KRW", "JPY"];

/** One figure per currency. Converting would let a rate change the past. */
function Total({ label, totals, note }: { label: string; totals: CurrencyTotal[]; note: string }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="numeric mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xl text-ink">
        {totals.length === 0 ? <span className="text-subtle">Nothing yet</span> : null}
        {totals.map((t) => (
          <span key={t.currency}>{formatMinor(t.totalMinor, t.currency)}</span>
        ))}
      </p>
      <p className="mt-0.5 text-sm text-subtle">{note}</p>
    </div>
  );
}

type Draft = {
  description: string;
  amount: string;
  currency: string;
  paidByParticipantId: string;
  consumerIds: string[];
  isPrivate: boolean;
};

export function Expenses({
  tripId,
  participants,
  myParticipantId,
  version,
  onChange,
}: {
  tripId: string;
  participants: Participant[];
  myParticipantId: string;
  version: number;
  onChange: () => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    description: "",
    amount: "",
    currency: CURRENCIES[0] ?? "CAD",
    paidByParticipantId: myParticipantId,
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

  const nameFor = (id: string) => participants.find((p) => p.id === id)?.displayName ?? "someone";
  const payerOutside = !draft.isPrivate && !draft.consumerIds.includes(draft.paidByParticipantId);

  if (expenses === null || summary === null) return <p className="text-sm text-subtle">Loading</p>;

  return (
    <div className="grid gap-7">
      <Panel className="flex flex-wrap divide-x divide-line">
        <Total
          label="The trip"
          totals={summary.shared}
          note="Everything shared, in the currency it was spent."
        />
        <Total label="You" totals={summary.mine} note="Your share, plus your private spending." />
      </Panel>

      <Panel>
        <PanelHeader
          title="Spending"
          description="Who fronted the money and whose it was are different questions, so both get recorded."
          action={
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              <Plus />
              Add expense
            </Button>
          }
        />

        {expenses.length === 0 ? (
          <Empty>
            Nothing recorded yet. Add what you spend as you go and the split works itself out at
            the end.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-sunken"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-ink">{expense.description}</span>
                  {expense.isPrivate && (
                    <Badge className="ml-2">
                      <EyeOff className="size-3" />
                      private
                    </Badge>
                  )}
                  <span className="mt-0.5 block text-sm text-muted">
                    {expense.paidByName} paid
                    {expense.shares.length > 0 &&
                      ` — ${expense.shares
                        .map((s) => `${s.displayName} ${formatMinor(s.amountMinor, expense.currency)}`)
                        .join(", ")}`}
                  </span>
                </span>

                <span className="numeric shrink-0 font-medium text-ink">
                  {formatMinor(expense.amountMinor, expense.currency)}
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${expense.description}`}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                  onClick={() => act(() => api.removeExpense(tripId, expense.id))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add expense"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              form="new-expense"
              variant="primary"
              disabled={
                busy ||
                draft.description.trim() === "" ||
                draft.amount.trim() === "" ||
                (!draft.isPrivate && draft.consumerIds.length === 0)
              }
            >
              {busy ? "Working" : "Add expense"}
            </Button>
          </>
        }
      >
        <form
          id="new-expense"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseAmount(draft.amount, draft.currency);
            if (!parsed.ok) {
              setError(parsed.error);
              return;
            }
            setBusy(true);
            void act(async () => {
              await api.addExpense(tripId, {
                description: draft.description,
                amountMinor: parsed.amountMinor,
                currency: draft.currency,
                paidByParticipantId: draft.paidByParticipantId,
                isPrivate: draft.isPrivate,
                ...(draft.isPrivate ? {} : { consumerIds: draft.consumerIds }),
              });
              setDraft({ ...draft, description: "", amount: "" });
              setOpen(false);
            }).finally(() => setBusy(false));
          }}
        >
          <Field label="What it was for">
            <Input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Dinner at Gwangjang"
              required
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="Amount">
              <Input
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0.00"
                inputMode="decimal"
                className="numeric text-right"
                required
              />
            </Field>
            <Field label="Currency">
              <Select
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Paid by">
            <Select
              value={draft.paidByParticipantId}
              onChange={(e) => setDraft({ ...draft, paidByParticipantId: e.target.value })}
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </Field>

          {!draft.isPrivate && (
            <Field
              label="Split between"
              hint={
                payerOutside
                  ? `${nameFor(draft.paidByParticipantId)} is owed the whole amount.`
                  : "Anything that will not divide evenly goes to whoever paid."
              }
            >
              <div className="flex flex-wrap gap-x-1 gap-y-0.5">
                {participants.map((p) => {
                  const on = draft.consumerIds.includes(p.id);
                  return (
                    <Checkbox
                      key={p.id}
                      checked={on}
                      onCheckedChange={() =>
                        setDraft({
                          ...draft,
                          consumerIds: on
                            ? draft.consumerIds.filter((id) => id !== p.id)
                            : [...draft.consumerIds, p.id],
                        })
                      }
                    >
                      {p.displayName}
                    </Checkbox>
                  );
                })}
              </div>
            </Field>
          )}

          <Checkbox
            checked={draft.isPrivate}
            onCheckedChange={(value) => setDraft({ ...draft, isPrivate: value })}
            className="-ml-1.5"
          >
            <span className="text-muted">Private — only you see it, and it stays out of the split</span>
          </Checkbox>
        </form>
      </Dialog>
    </div>
  );
}
