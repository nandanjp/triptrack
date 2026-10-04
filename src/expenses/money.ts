/**
 * Minor-unit conversion, shared by the API and the SPA — they ship in one
 * artifact, so this is imported by both rather than duplicated (ADR-0003).
 *
 * Money is stored as integer minor units (D11). The exponent is a property of
 * the currency, not of the data: KRW and JPY have none, CAD and USD have two,
 * and a few have three. Intl knows them all, which beats keeping a table.
 */

const DEFAULT_EXPONENT = 2;

/** Decimal places the currency actually uses. */
export function exponentFor(currency: string): number {
  try {
    // Optional in the type, always present in practice for a currency format.
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? DEFAULT_EXPONENT
    );
  } catch {
    // An unrecognised code: assume the common case rather than throwing.
    return DEFAULT_EXPONENT;
  }
}

export type ParseResult = { ok: true; amountMinor: number } | { ok: false; error: string };

/**
 * Parses what someone typed into exact minor units, **without** going through
 * a float. `12.34 * 100` is 1233.9999999999998, so multiplying a parsed float
 * is how money quietly loses a unit.
 */
export function parseAmount(input: string, currency: string): ParseResult {
  const text = input.trim().replace(/,/g, "");
  if (text === "") return { ok: false, error: "enter an amount" };

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (match === null) return { ok: false, error: "that is not an amount" };

  const [, sign, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return { ok: false, error: "that is not an amount" };

  const exponent = exponentFor(currency);
  if (fraction.length > exponent) {
    return {
      ok: false,
      error:
        exponent === 0
          ? `${currency} has no decimal places`
          : `${currency} has at most ${exponent} decimal places`,
    };
  }

  // String arithmetic end to end: pad the fraction out to the exponent and
  // concatenate, so the result is exact by construction.
  const minor = `${whole === "" ? "0" : whole}${fraction.padEnd(exponent, "0")}`;
  const amountMinor = Number(minor) * (sign === "-" ? -1 : 1);

  if (!Number.isSafeInteger(amountMinor)) return { ok: false, error: "that amount is too large" };
  if (amountMinor === 0) return { ok: false, error: "amount cannot be zero" };

  return { ok: true, amountMinor };
}

/** Renders minor units back for display, in the currency's own convention. */
export function formatMinor(amountMinor: number, currency: string): string {
  const exponent = exponentFor(currency);
  const major = amountMinor / 10 ** exponent;
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(major);
  } catch {
    return `${major.toFixed(exponent)} ${currency}`;
  }
}
