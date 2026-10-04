import { test } from "node:test";
import assert from "node:assert/strict";
import { sharesSumTo, splitExpense, type Share, type SplitRequest } from "../src/expenses/split.ts";

const ok = (request: SplitRequest): Share[] => {
  const result = splitExpense(request);
  assert.ok(result.ok, `expected a split, got: ${result.ok ? "" : result.error}`);
  return result.shares;
};

const failure = (request: SplitRequest): string => {
  const result = splitExpense(request);
  assert.equal(result.ok, false, "expected a rejection");
  return result.ok ? "" : result.error;
};

const owed = (shares: Share[], id: string): number =>
  shares.find((s) => s.participantId === id)?.amountMinor ?? 0;

test("the worked example: the payer owes nothing when others cover the total", () => {
  // P1 pays ₩10,000; P2 owes ₩4,000 and P3 owes ₩6,000, so P1 owes nothing.
  const shares = ok({
    totalMinor: 10_000,
    payerId: "p1",
    mode: "exact",
    consumerIds: ["p1", "p2", "p3"],
    exactShares: [
      { participantId: "p2", amountMinor: 4_000 },
      { participantId: "p3", amountMinor: 6_000 },
    ],
  });

  assert.equal(owed(shares, "p1"), 0);
  assert.equal(owed(shares, "p2"), 4_000);
  assert.equal(owed(shares, "p3"), 6_000);
  assert.ok(sharesSumTo(shares, 10_000));
});

test("an equal split gives the odd unit to the payer", () => {
  // ₩10,000 three ways does not divide. Somebody has to hold the extra won.
  const shares = ok({
    totalMinor: 10_000,
    payerId: "p1",
    mode: "equal",
    consumerIds: ["p1", "p2", "p3"],
  });

  assert.equal(owed(shares, "p2"), 3_333);
  assert.equal(owed(shares, "p3"), 3_333);
  assert.equal(owed(shares, "p1"), 3_334, "the payer absorbs the rounding");
  assert.ok(sharesSumTo(shares, 10_000));
});

test("an equal split that divides cleanly leaves no remainder anywhere", () => {
  const shares = ok({ totalMinor: 9_000, payerId: "p1", mode: "equal", consumerIds: ["p1", "p2", "p3"] });
  assert.deepEqual(shares.map((s) => s.amountMinor), [3_000, 3_000, 3_000]);
});

test("paying for someone else's taxi leaves the payer owing nothing", () => {
  // The payer is not a consumer, so they are owed the whole amount.
  const shares = ok({ totalMinor: 2_500, payerId: "p1", mode: "equal", consumerIds: ["p2"] });

  assert.equal(owed(shares, "p1"), 0);
  assert.equal(owed(shares, "p2"), 2_500);
  assert.ok(sharesSumTo(shares, 2_500));
});

test("a payer outside the split still absorbs an indivisible remainder", () => {
  // 100 across 3 others is 33 each; the stray unit cannot vanish.
  const shares = ok({ totalMinor: 100, payerId: "p1", mode: "equal", consumerIds: ["p2", "p3", "p4"] });

  assert.equal(owed(shares, "p1"), 1);
  assert.ok(sharesSumTo(shares, 100));
});

test("a single consumer owes the lot", () => {
  const shares = ok({ totalMinor: 777, payerId: "p1", mode: "equal", consumerIds: ["p1"] });
  assert.deepEqual(shares, [{ participantId: "p1", amountMinor: 777 }]);
});

test("a refund is the mirror of a charge", () => {
  // Cancellations are negative expenses, so the arithmetic has to hold there.
  const shares = ok({ totalMinor: -10_000, payerId: "p1", mode: "equal", consumerIds: ["p1", "p2", "p3"] });

  assert.ok(sharesSumTo(shares, -10_000));
  assert.ok(shares.every((s) => s.amountMinor < 0), "nobody gains from a refund");
  assert.equal(owed(shares, "p2"), -3_333);
  assert.equal(owed(shares, "p1"), -3_334, "the payer absorbs it in the same direction");
});

test("an exact refund splits against named people", () => {
  const shares = ok({
    totalMinor: -5_000,
    payerId: "p1",
    mode: "exact",
    consumerIds: ["p1", "p2"],
    exactShares: [{ participantId: "p2", amountMinor: -2_000 }],
  });

  assert.equal(owed(shares, "p2"), -2_000);
  assert.equal(owed(shares, "p1"), -3_000);
  assert.ok(sharesSumTo(shares, -5_000));
});

test("zero shares are not stored, because owing nothing is not involvement", () => {
  const shares = ok({
    totalMinor: 1_000,
    payerId: "p1",
    mode: "exact",
    consumerIds: ["p1", "p2", "p3"],
    exactShares: [
      { participantId: "p2", amountMinor: 1_000 },
      { participantId: "p3", amountMinor: 0 },
    ],
  });

  assert.deepEqual(shares, [{ participantId: "p2", amountMinor: 1_000 }]);
  assert.equal(owed(shares, "p1"), 0, "the payer is covered, so holds no share");
});

test("the payer's share is derived, never stated", () => {
  const error = failure({
    totalMinor: 1_000,
    payerId: "p1",
    mode: "exact",
    consumerIds: ["p1", "p2"],
    exactShares: [{ participantId: "p1", amountMinor: 500 }],
  });
  assert.match(error, /remainder/);
});

test("shares cannot exceed the amount", () => {
  const error = failure({
    totalMinor: 1_000,
    payerId: "p1",
    mode: "exact",
    consumerIds: ["p1", "p2"],
    exactShares: [{ participantId: "p2", amountMinor: 1_500 }],
  });
  assert.match(error, /exceed/);
});

test("a refund cannot hand anyone a positive share", () => {
  const error = failure({
    totalMinor: -1_000,
    payerId: "p1",
    mode: "exact",
    consumerIds: ["p1", "p2"],
    exactShares: [{ participantId: "p2", amountMinor: 500 }],
  });
  assert.match(error, /refund/);
});

test("malformed input is rejected rather than rounded", () => {
  assert.match(failure({ totalMinor: 0, payerId: "p1", mode: "equal", consumerIds: ["p1"] }), /zero/);
  assert.match(failure({ totalMinor: 10.5, payerId: "p1", mode: "equal", consumerIds: ["p1"] }), /whole/);
  assert.match(failure({ totalMinor: 100, payerId: "p1", mode: "equal", consumerIds: [] }), /at least one/);
  assert.match(
    failure({
      totalMinor: 100,
      payerId: "p1",
      mode: "exact",
      consumerIds: ["p1", "p2"],
      exactShares: [
        { participantId: "p2", amountMinor: 10 },
        { participantId: "p2", amountMinor: 20 },
      ],
    }),
    /twice/,
  );
});

test("duplicate consumers do not inflate an equal split", () => {
  const shares = ok({ totalMinor: 900, payerId: "p1", mode: "equal", consumerIds: ["p1", "p2", "p2"] });
  assert.ok(sharesSumTo(shares, 900));
  assert.equal(owed(shares, "p2"), 450, "counted once");
});

/**
 * The invariant is the whole point, so it is checked over a wide input space
 * rather than only the cases someone thought to enumerate. A share set that
 * does not sum to its total makes settlement wrong in a way no later step can
 * detect.
 */
test("shares always sum to the total, across thousands of random splits", () => {
  let seed = 20261004;
  const rand = (n: number): number => {
    // Deterministic, so a failure is reproducible.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };

  const people = ["p1", "p2", "p3", "p4", "p5", "p6"];
  let checked = 0;

  for (let i = 0; i < 4_000; i += 1) {
    const sign = rand(5) === 0 ? -1 : 1;
    const totalMinor = sign * (rand(5_000_000) + 1);
    const payerId = people[rand(people.length)] ?? "p1";
    const count = rand(people.length) + 1;
    const consumerIds = people.slice(0, count);

    if (rand(2) === 0) {
      const result = splitExpense({ totalMinor, payerId, mode: "equal", consumerIds });
      assert.ok(result.ok, "an equal split of valid input must succeed");
      assert.ok(
        sharesSumTo(result.shares, totalMinor),
        `equal split lost money: total=${totalMinor} consumers=${count}`,
      );
      checked += 1;
      continue;
    }

    // Exact mode: hand out a slice of the total to non-payers, under budget.
    let left = Math.abs(totalMinor);
    const exactShares = consumerIds
      .filter((id) => id !== payerId)
      .map((participantId) => {
        const take = left === 0 ? 0 : rand(left + 1);
        left -= take;
        return { participantId, amountMinor: sign * take };
      });

    const result = splitExpense({ totalMinor, payerId, mode: "exact", consumerIds, exactShares });
    assert.ok(result.ok, `exact split rejected valid input: ${result.ok ? "" : result.error}`);
    assert.ok(
      sharesSumTo(result.shares, totalMinor),
      `exact split lost money: total=${totalMinor}`,
    );
    checked += 1;
  }

  assert.equal(checked, 4_000);
});
