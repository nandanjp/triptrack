import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTransfers, isSettled, simplifyDebts, type Balance } from "../src/expenses/settle.ts";

const plan = (balances: Balance[]) => {
  const result = simplifyDebts(balances);
  assert.ok(result.ok, `expected a plan, got: ${result.ok ? "" : result.error}`);
  return result.transfers;
};

const rejected = (balances: Balance[]) => {
  const result = simplifyDebts(balances);
  assert.equal(result.ok, false);
  return result.ok ? "" : result.error;
};

/** The property that matters: the plan must actually clear the balances. */
const clears = (balances: Balance[], transfers: ReturnType<typeof plan>) =>
  isSettled(applyTransfers(balances, transfers));

test("one debtor and one creditor is a single payment", () => {
  const balances: Balance[] = [
    { participantId: "a", netMinor: -3_000 },
    { participantId: "b", netMinor: 3_000 },
  ];
  const transfers = plan(balances);

  assert.deepEqual(transfers, [{ fromParticipantId: "a", toParticipantId: "b", amountMinor: 3_000 }]);
  assert.ok(clears(balances, transfers));
});

test("nobody pays anybody when everyone is square", () => {
  const balances: Balance[] = [
    { participantId: "a", netMinor: 0 },
    { participantId: "b", netMinor: 0 },
  ];
  assert.deepEqual(plan(balances), []);
  assert.ok(isSettled(balances));
});

test("the dinner case: one payer owed by two others is two payments", () => {
  // Owner fronted ₩40,000 and is owed two thirds of it.
  const balances: Balance[] = [
    { participantId: "owner", netMinor: 26_666 },
    { participantId: "sister", netMinor: -13_333 },
    { participantId: "friend", netMinor: -13_333 },
  ];
  const transfers = plan(balances);

  assert.equal(transfers.length, 2);
  assert.ok(transfers.every((t) => t.toParticipantId === "owner"));
  assert.ok(clears(balances, transfers));
});

test("a chain collapses instead of being paid around the circle", () => {
  // A owes B, B owes C. The useful answer is one payment, not two.
  const balances: Balance[] = [
    { participantId: "a", netMinor: -5_000 },
    { participantId: "b", netMinor: 0 },
    { participantId: "c", netMinor: 5_000 },
  ];
  const transfers = plan(balances);

  assert.deepEqual(transfers, [{ fromParticipantId: "a", toParticipantId: "c", amountMinor: 5_000 }]);
  assert.ok(clears(balances, transfers));
});

test("a plan never needs more than one payment fewer than there are people", () => {
  const balances: Balance[] = [
    { participantId: "a", netMinor: -700 },
    { participantId: "b", netMinor: -300 },
    { participantId: "c", netMinor: -100 },
    { participantId: "d", netMinor: 500 },
    { participantId: "e", netMinor: 600 },
  ];
  const transfers = plan(balances);

  assert.ok(transfers.length <= balances.length - 1, `${transfers.length} payments for 5 people`);
  assert.ok(clears(balances, transfers));
});

test("the plan is stable, so it does not reshuffle between page loads", () => {
  const balances: Balance[] = [
    { participantId: "b", netMinor: -1_000 },
    { participantId: "a", netMinor: -1_000 },
    { participantId: "c", netMinor: 2_000 },
  ];
  assert.deepEqual(plan(balances), plan([...balances].reverse()), "order of input must not matter");
});

test("balances that do not sum to zero are reported, not absorbed", () => {
  const error = rejected([
    { participantId: "a", netMinor: -100 },
    { participantId: "b", netMinor: 50 },
  ]);
  assert.match(error, /sum to zero \(off by -50\)/);
});

test("fractional balances are refused", () => {
  assert.match(rejected([{ participantId: "a", netMinor: 0.5 }, { participantId: "b", netMinor: -0.5 }]), /whole/);
});

test("an empty trip settles trivially", () => {
  assert.deepEqual(plan([]), []);
});

/**
 * Settlement is the part a user will check against their own arithmetic, so
 * the clearing property is exercised far beyond the enumerated cases.
 */
test("every generated plan clears its balances, across thousands of cases", () => {
  let seed = 7_20261004;
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };

  for (let i = 0; i < 3_000; i += 1) {
    const people = 2 + rand(7);
    const balances: Balance[] = [];
    let running = 0;

    // Build a set that sums to zero by construction, as real data does.
    for (let p = 0; p < people - 1; p += 1) {
      const net = rand(2_000_001) - 1_000_000;
      balances.push({ participantId: `p${p}`, netMinor: net });
      running += net;
    }
    balances.push({ participantId: `p${people - 1}`, netMinor: -running });

    const result = simplifyDebts(balances);
    assert.ok(result.ok, `rejected a valid balance set: ${result.ok ? "" : result.error}`);
    assert.ok(
      isSettled(applyTransfers(balances, result.transfers)),
      `plan failed to clear: ${JSON.stringify(balances)}`,
    );
    assert.ok(
      result.transfers.length <= Math.max(0, balances.length - 1),
      `too many payments: ${result.transfers.length} for ${balances.length} people`,
    );
    assert.ok(result.transfers.every((t) => t.amountMinor > 0), "no zero or negative payments");
    assert.ok(
      result.transfers.every((t) => t.fromParticipantId !== t.toParticipantId),
      "nobody pays themselves",
    );
  }
});
