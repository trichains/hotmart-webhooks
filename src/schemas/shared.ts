import { z } from "zod";

/**
 * A string schema whose inferred type keeps editor autocomplete for the known
 * values while still accepting anything else. Hotmart adds enum values without
 * notice (the official purchase example already uses a commission source the
 * field table does not list), so rejecting unknown values would break parsing
 * of otherwise valid events.
 */
export function lenientEnum<const T extends readonly string[]>(_known: T) {
  return z.string() as unknown as z.ZodType<T[number] | (string & {}), string>;
}

/**
 * Timestamps are documented as milliseconds since the Unix epoch, but some
 * official examples send them as strings (e.g. purchase.order_date: "123243546",
 * date_next_charge: "2022-09-01T12:00:00.000Z"). Both are accepted; use
 * `toDate()` to normalise.
 */
export const timestampSchema = z.union([z.number(), z.string()]);

/** `{ value, currency_value }` money object used across payloads. */
export const moneySchema = z.looseObject({
  value: z.number(),
  /** ISO 4217 currency code, e.g. "BRL". */
  currency_value: z.string(),
});
export type Money = z.infer<typeof moneySchema>;

/** Fields shared by every v2.0.0 webhook. */
export const envelopeShape = {
  /** Unique event id. Use it as the idempotency key. */
  id: z.string().min(1),
  /** Event creation time, milliseconds since the Unix epoch. */
  creation_date: z.number(),
  /**
   * Webhook version chosen in the Hotmart configuration. Always "2.0.0" for the
   * payloads this library models; kept as a plain string so a minor bump does
   * not reject every event.
   */
  version: z.string(),
} as const;
