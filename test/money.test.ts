import { test } from "node:test";
import assert from "node:assert/strict";
import { exponentFor, formatMinor, parseAmount } from "../src/expenses/money.ts";

const minor = (input: string, currency: string): number => {
  const result = parseAmount(input, currency);
  assert.ok(result.ok, `expected a parse, got: ${result.ok ? "" : result.error}`);
  return result.amountMinor;
};

const rejected = (input: string, currency: string): string => {
  const result = parseAmount(input, currency);
  assert.equal(result.ok, false, `expected "${input}" to be rejected`);
  return result.ok ? "" : result.error;
};

test("the exponent comes from the currency, not from the data", () => {
  assert.equal(exponentFor("CAD"), 2);
  assert.equal(exponentFor("KRW"), 0, "won has no subunit");
  assert.equal(exponentFor("JPY"), 0);
  assert.equal(exponentFor("ZZZ"), 2, "an unknown code falls back rather than throwing");
});

test("parsing is exact, where multiplying a float is not", () => {
  // 12.34 * 100 is 1233.9999999999998 in binary floating point.
  assert.equal(minor("12.34", "CAD"), 1234);
  assert.equal(minor("0.07", "CAD"), 7);
  assert.equal(minor("1.1", "CAD"), 110, "a short fraction pads, it does not truncate");
  assert.equal(minor("8.70", "CAD"), 870);
});

test("a currency with no subunit takes whole numbers only", () => {
  assert.equal(minor("40000", "KRW"), 40_000);
  assert.match(rejected("40000.5", "KRW"), /no decimal places/);
});

test("too many decimals is refused rather than rounded away", () => {
  assert.match(rejected("12.345", "CAD"), /at most 2/);
});

test("negatives parse, because a refund is a negative expense", () => {
  assert.equal(minor("-250.00", "CAD"), -25_000);
  assert.equal(minor("-40000", "KRW"), -40_000);
});

test("forgiving about how people type", () => {
  assert.equal(minor("1,234.50", "CAD"), 123_450, "thousands separators");
  assert.equal(minor("  12.34  ", "CAD"), 1234, "stray whitespace");
  assert.equal(minor(".50", "CAD"), 50, "a leading dot");
  assert.equal(minor("12.", "CAD"), 1200, "a trailing dot");
});

test("nonsense and zero are refused", () => {
  for (const bad of ["", "   ", "abc", "1.2.3", "12e5", "$12", "--5"]) {
    assert.ok(rejected(bad, "CAD").length > 0, bad);
  }
  assert.match(rejected("0", "CAD"), /zero/);
  assert.match(rejected("0.00", "CAD"), /zero/);
});

test("amounts beyond exact integer range are refused, not silently rounded", () => {
  assert.match(rejected("99999999999999999", "CAD"), /too large/);
});

test("formatting round-trips what was parsed", () => {
  for (const [input, currency] of [["12.34", "CAD"], ["40000", "KRW"], ["-250.00", "CAD"]] as const) {
    const parsed = minor(input, currency);
    const shown = formatMinor(parsed, currency);
    const reparsed = parseAmount(shown.replace(/[^\d.,-]/g, ""), currency);
    assert.ok(reparsed.ok, `${shown} should reparse`);
    assert.equal(reparsed.amountMinor, parsed, `${input} ${currency} -> ${shown}`);
  }
});
