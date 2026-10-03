import type { Money } from "./schemas/shared.js";

// ISO 4217 minor units for currencies that do not use 2 decimals.
// Source: ISO 4217 list one (SIX Group), current as of 2026.
const ZERO_DECIMALS = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_DECIMALS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
const FOUR_DECIMALS = new Set(["CLF", "UYW"]);

function normaliseCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new RangeError(`Invalid ISO 4217 currency code: "${currency}"`);
  }
  return code;
}

/** Number of minor-unit digits for an ISO 4217 code (BRL → 2, JPY → 0, KWD → 3). */
export function currencyDecimals(currency: string): number {
  const code = normaliseCurrency(currency);
  if (ZERO_DECIMALS.has(code)) return 0;
  if (THREE_DECIMALS.has(code)) return 3;
  if (FOUR_DECIMALS.has(code)) return 4;
  return 2;
}

/**
 * Shift the decimal point using the number's string form instead of
 * multiplying, so 1.005 BRL becomes 101 (not 100) and 97.9 becomes 9790
 * (not 9790.000000000002).
 */
function shift(value: number, places: number): number {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/**
 * Convert a major-unit amount (as Hotmart sends it) to integer minor units,
 * rounding half away from zero: `toMinorUnits(97.9, "BRL") === 9790`,
 * `toMinorUnits(1500, "JPY") === 1500`.
 *
 * Also accepts a Hotmart money object: `toMinorUnits(event.data.purchase.price)`.
 */
export function toMinorUnits(money: Money): number;
export function toMinorUnits(value: number, currency: string): number;
export function toMinorUnits(valueOrMoney: number | Money, currency?: string): number {
  const value = typeof valueOrMoney === "number" ? valueOrMoney : valueOrMoney.value;
  const code = typeof valueOrMoney === "number" ? currency : valueOrMoney.currency_value;
  if (code === undefined) throw new TypeError("toMinorUnits: currency is required");
  if (!Number.isFinite(value)) throw new RangeError(`toMinorUnits: value must be finite, got ${value}`);

  const shifted = shift(Math.abs(value), currencyDecimals(code));
  const rounded = Math.round(shifted);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/** Inverse of `toMinorUnits`: `fromMinorUnits(9790, "BRL") === 97.9`. */
export function fromMinorUnits(minor: number, currency: string): number {
  if (!Number.isInteger(minor)) throw new RangeError(`fromMinorUnits: expected an integer, got ${minor}`);
  return shift(minor, -currencyDecimals(currency));
}
