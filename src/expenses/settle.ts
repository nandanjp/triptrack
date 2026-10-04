/**
 * Turning balances into a list of payments. Pure functions, no database and
 * no HTTP — the other half of the module boundary `ARCHITECTURE.md` asked for
 * around settlement.
 *
 * Balances are always *derived*: `sum(paid) − sum(owed)`, adjusted by payments
 * already recorded. Nothing here is stored. A stored running balance is how
 * these systems go quietly wrong, and recomputing is cheap at trip scale.
 */

/** Positive means owed money; negative means owing it. */
export type Balance = { participantId: string; netMinor: number };

export type Transfer = {
  fromParticipantId: string;
  toParticipantId: string;
  amountMinor: number;
};

export type SimplifyResult =
  | { ok: true; transfers: Transfer[] }
  | { ok: false; error: string };

/**
 * Builds the shortest practical set of payments that clears everyone.
 *
 * Greedy largest-debtor-to-largest-creditor. It is not guaranteed minimal —
 * that problem is NP-hard — but it always produces at most `n − 1` payments,
 * which is the property that actually matters: nobody wants to make four
 * transfers where one would do.
 *
 * The input must sum to zero, which it does by construction: every expense's
 * shares sum to its total, so what the group paid equals what the group owes,
 * and a recorded payment moves the same amount out of one balance and into
 * another. A non-zero sum means something upstream is broken, so it is
 * reported rather than quietly absorbed.
 */
export function simplifyDebts(balances: readonly Balance[]): SimplifyResult {
  for (const balance of balances) {
    if (!Number.isInteger(balance.netMinor)) {
      return { ok: false, error: "balances must be whole minor units" };
    }
  }

  const total = balances.reduce((sum, b) => sum + b.netMinor, 0);
  if (total !== 0) {
    return { ok: false, error: `balances do not sum to zero (off by ${total})` };
  }

  // Sorted by amount, then by id, so the same balances always produce the
  // same plan — a settlement that reshuffles on every page load is useless.
  const debtors = balances
    .filter((b) => b.netMinor < 0)
    .map((b) => ({ ...b, remaining: -b.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || a.participantId.localeCompare(b.participantId));

  const creditors = balances
    .filter((b) => b.netMinor > 0)
    .map((b) => ({ ...b, remaining: b.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || a.participantId.localeCompare(b.participantId));

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    if (debtor === undefined || creditor === undefined) break;

    const amountMinor = Math.min(debtor.remaining, creditor.remaining);
    if (amountMinor > 0) {
      transfers.push({
        fromParticipantId: debtor.participantId,
        toParticipantId: creditor.participantId,
        amountMinor,
      });
      debtor.remaining -= amountMinor;
      creditor.remaining -= amountMinor;
    }

    if (debtor.remaining === 0) d += 1;
    if (creditor.remaining === 0) c += 1;
  }

  return { ok: true, transfers };
}

/**
 * Net position after applying a set of payments — used to check that a plan
 * actually clears the balances it was built from.
 */
export function applyTransfers(
  balances: readonly Balance[],
  transfers: readonly Transfer[],
): Balance[] {
  const net = new Map(balances.map((b) => [b.participantId, b.netMinor]));

  for (const transfer of transfers) {
    // Paying down a debt moves the payer's negative balance toward zero.
    net.set(transfer.fromParticipantId, (net.get(transfer.fromParticipantId) ?? 0) + transfer.amountMinor);
    net.set(transfer.toParticipantId, (net.get(transfer.toParticipantId) ?? 0) - transfer.amountMinor);
  }

  return [...net.entries()].map(([participantId, netMinor]) => ({ participantId, netMinor }));
}

export const isSettled = (balances: readonly Balance[]): boolean =>
  balances.every((b) => b.netMinor === 0);
