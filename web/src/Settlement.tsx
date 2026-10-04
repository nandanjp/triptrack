import { useEffect, useState } from "react";
import { ArrowRight, Check, Lock, Undo2 } from "lucide-react";
import { formatMinor } from "../../src/expenses/money.ts";
import { api, type SettlementView } from "./api.ts";
import { Button } from "@/ui/button.tsx";
import { Empty, Panel, PanelBody, PanelHeader } from "@/ui/surface.tsx";

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

  if (view === null) return <p className="text-sm text-subtle">Loading</p>;

  const nameFor = (id: string) => view.participants.find((p) => p.id === id)?.displayName ?? "someone";
  const settled = view.settledAt !== null;

  return (
    <div className="grid gap-4">
      <Panel>
        <PanelHeader
          title="Settling up"
          description={
            settled
              ? "The money is closed. Expenses are read-only until this is reopened."
              : "Balances are worked out from what everyone paid and owes, every time you look."
          }
          action={
            isOwner &&
            (settled ? (
              <Button size="sm" onClick={() => act(() => api.reopenTrip(tripId))}>
                <Undo2 />
                Reopen
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={view.outstanding}
                title={view.outstanding ? "Record the remaining payments first" : undefined}
                onClick={() => act(() => api.settleTrip(tripId))}
              >
                <Lock />
                Mark settled
              </Button>
            ))
          }
        />

        {settled && (
          <PanelBody className="flex items-center gap-2 border-b border-line text-sm text-positive">
            <Check className="size-4" />
            Settled on{" "}
            {new Date(view.settledAt ?? "").toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </PanelBody>
        )}

        {view.perCurrency.length === 0 ? (
          <Empty>
            Nothing shared yet. Once there are expenses with more than one person on them, the
            balances and the shortest set of payments that clears them show up here.
          </Empty>
        ) : (
          <div className="divide-y divide-line">
            {view.perCurrency.map((group) => (
              <section key={group.currency} className="px-4 py-3">
                {view.perCurrency.length > 1 && (
                  <h3 className="numeric mb-2 text-sm font-medium text-muted">{group.currency}</h3>
                )}

                {group.inconsistency !== null && (
                  // Impossible by construction, so silence would be worse than
                  // an alarming message.
                  <p className="mb-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-sm text-danger">
                    These balances do not add up ({group.inconsistency}). Something is wrong with
                    the recorded spending.
                  </p>
                )}

                {group.balances.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-positive">
                    <Check className="size-4" />
                    Everyone is square.
                  </p>
                ) : (
                  <>
                    <ul className="grid gap-1">
                      {group.balances.map((balance) => (
                        <li key={balance.participantId} className="flex items-baseline gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate text-ink">
                            {nameFor(balance.participantId)}
                          </span>
                          <span
                            className={
                              balance.netMinor > 0
                                ? "numeric text-positive"
                                : "numeric text-caution"
                            }
                          >
                            {balance.netMinor > 0
                              ? `is owed ${formatMinor(balance.netMinor, group.currency)}`
                              : `owes ${formatMinor(-balance.netMinor, group.currency)}`}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {group.plan.length > 0 && (
                      <div className="mt-3 rounded-md border border-line bg-sunken p-2.5">
                        <p className="mb-1.5 text-sm text-muted">
                          {group.plan.length === 1
                            ? "One payment clears this:"
                            : `${group.plan.length} payments clear this:`}
                        </p>
                        <ul className="grid gap-1">
                          {group.plan.map((transfer, index) => (
                            <li
                              key={`${transfer.fromParticipantId}-${transfer.toParticipantId}-${index}`}
                              className="flex flex-wrap items-center gap-2 text-sm"
                            >
                              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                <span className="truncate text-ink">
                                  {nameFor(transfer.fromParticipantId)}
                                </span>
                                <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                                <span className="truncate text-ink">
                                  {nameFor(transfer.toParticipantId)}
                                </span>
                                <span className="numeric shrink-0 font-medium text-ink">
                                  {formatMinor(transfer.amountMinor, group.currency)}
                                </span>
                              </span>
                              {!settled && (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    act(() =>
                                      api.recordPayment(tripId, { ...transfer, currency: group.currency }),
                                    )
                                  }
                                >
                                  Mark paid
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </section>
            ))}
          </div>
        )}
      </Panel>

      {view.recorded.length > 0 && (
        <details className="rounded-lg border border-line bg-raised">
          <summary className="cursor-pointer px-4 py-2.5 text-sm text-muted select-none">
            {view.recorded.length} payment{view.recorded.length === 1 ? "" : "s"} recorded
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {view.recorded.map((payment) => (
              <li
                key={payment.id}
                className="group flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm"
              >
                <span className="numeric text-muted">{payment.settledOn}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-ink">{nameFor(payment.fromParticipantId)}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                  <span className="truncate text-ink">{nameFor(payment.toParticipantId)}</span>
                </span>
                <span className="numeric text-ink">
                  {formatMinor(payment.amountMinor, payment.currency)}
                </span>
                {!settled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                    onClick={() => act(() => api.unrecordPayment(tripId, payment.id))}
                  >
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error !== null && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
