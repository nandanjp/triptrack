/**
 * Expense splitting, with no database and no HTTP in sight. This is the
 * riskiest arithmetic in the project — `ARCHITECTURE.md` names settlement as
 * the subdomain that could swallow it — so it lives behind a module boundary
 * and is tested as pure functions.
 *
 * Money is integer minor units throughout (D11). There is no decimal type in
 * JavaScript, and integers are exact to 2^53, so the only discipline needed is
 * never to divide into a float and keep it.
 */

export const SPLIT_MODES = ["equal", "exact"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export type Share = { participantId: string; amountMinor: number };

export type SplitRequest = {
  /** Non-zero. Negative is a refund — see D: cancellations are negative expenses. */
  totalMinor: number;
  payerId: string;
  mode: SplitMode;
  /** Who consumed it. The payer may or may not be among them. */
  consumerIds: readonly string[];
  /** `exact` only: what each named non-payer owes. */
  exactShares?: readonly Share[];
};

export type SplitResult =
  | { ok: true; shares: Share[] }
  | { ok: false; error: string };

/**
 * The payer holds the remainder: their share is always
 * `total − sum(everyone else's)`, which may be zero.
 *
 * This is the rule that makes the sum-to-total invariant *structural* rather
 * than something to validate after the fact, and it falls out correctly for
 * the payer not being in the split at all — paying for someone else's taxi
 * leaves a remainder of zero (D13).
 */
export function splitExpense(request: SplitRequest): SplitResult {
  const { totalMinor, payerId, mode, consumerIds, exactShares } = request;

  if (!Number.isInteger(totalMinor)) return { ok: false, error: "amount must be whole minor units" };
  if (totalMinor === 0) return { ok: false, error: "amount cannot be zero" };

  return mode === "equal"
    ? splitEqually(totalMinor, payerId, consumerIds)
    : splitExactly(totalMinor, payerId, exactShares ?? []);
}

function splitEqually(totalMinor: number, payerId: string, consumerIds: readonly string[]): SplitResult {
  const consumers = [...new Set(consumerIds)];
  if (consumers.length === 0) return { ok: false, error: "an equal split needs at least one person" };

  // Truncation toward zero, so a refund behaves as the mirror of a charge
  // rather than drifting a unit the other way.
  const each = Math.trunc(totalMinor / consumers.length);
  const shares = new Map<string, number>(consumers.map((id) => [id, each]));

  // Whatever the division could not express goes to the payer — which is also
  // where the odd won on ₩10,000 split three ways lands.
  const remainder = totalMinor - each * consumers.length;
  if (remainder !== 0) {
    shares.set(payerId, (shares.get(payerId) ?? 0) + remainder);
  }

  return { ok: true, shares: toShares(shares) };
}

function splitExactly(totalMinor: number, payerId: string, exactShares: readonly Share[]): SplitResult {
  const seen = new Set<string>();

  for (const share of exactShares) {
    if (!Number.isInteger(share.amountMinor)) {
      return { ok: false, error: "every share must be whole minor units" };
    }
    if (share.participantId === payerId) {
      // The payer's share is derived, never stated: it is the remainder. Two
      // sources of truth for it is how the invariant gets broken.
      return { ok: false, error: "do not give the payer an explicit share; it is the remainder" };
    }
    if (seen.has(share.participantId)) {
      return { ok: false, error: "a participant appears twice in the shares" };
    }
    seen.add(share.participantId);
  }

  const others = exactShares.filter((s) => s.amountMinor !== 0);
  const assigned = others.reduce((sum, s) => sum + s.amountMinor, 0);
  const payerShare = totalMinor - assigned;

  // Opposite signs mean someone owes against the direction of the expense,
  // which is a data-entry error rather than a refund.
  if (totalMinor > 0 && (assigned < 0 || payerShare < 0)) {
    return { ok: false, error: "shares cannot exceed the amount, or be negative" };
  }
  if (totalMinor < 0 && (assigned > 0 || payerShare > 0)) {
    return { ok: false, error: "shares of a refund cannot be positive" };
  }

  const shares = new Map<string, number>(others.map((s) => [s.participantId, s.amountMinor]));
  if (payerShare !== 0) shares.set(payerId, payerShare);

  return { ok: true, shares: toShares(shares) };
}

/** Zero shares are not stored: owing nothing and not being involved coincide. */
const toShares = (shares: Map<string, number>): Share[] =>
  [...shares.entries()]
    .filter(([, amountMinor]) => amountMinor !== 0)
    .map(([participantId, amountMinor]) => ({ participantId, amountMinor }));

/** The invariant, as an assertion callers can make against their own data. */
export const sharesSumTo = (shares: readonly Share[], totalMinor: number): boolean =>
  shares.reduce((sum, s) => sum + s.amountMinor, 0) === totalMinor;
