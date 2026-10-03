import { createHash, timingSafeEqual } from "node:crypto";
import { getHeader, getQueryParam, queryFromUrl, type HeadersInput, type QueryInput } from "./http.js";

/** Header Hotmart uses to send the account token (hottok) on v2.0.0 webhooks. */
export const HOTTOK_HEADER = "x-hotmart-hottok";
/** Query parameter name used by some legacy (v1) integrations. */
export const HOTTOK_QUERY_PARAM = "hottok";

export interface VerifyHottokOptions {
  /** Your hottok, from Hotmart > Tools > Webhook > Authentication. */
  token: string;
  /**
   * Also accept the token from the `?hottok=` query parameter. Off by default:
   * tokens in URLs end up in access logs, proxies and browser history. Enable it
   * only while migrating an old v1 integration.
   */
  allowQueryToken?: boolean;
}

export type HottokSource = "header" | "query";

export type VerifyHottokResult =
  | { valid: true; source: HottokSource }
  | { valid: false; reason: "missing" | "mismatch" };

/** Anything that looks like a Web `Request` (only `headers` and `url` are read). */
export interface RequestLike {
  headers: HeadersInput;
  url?: string;
}

/** Headers plus an optional query, e.g. what a framework handler gives you. */
export interface HeadersAndQuery {
  headers: HeadersInput;
  query?: QueryInput;
}

export type VerifyInput = RequestLike | HeadersAndQuery | HeadersInput;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time string comparison. Both values are hashed first so the
 * comparison takes the same time regardless of where they differ and does not
 * leak the expected token's length (`timingSafeEqual` requires equal lengths).
 */
export function safeCompare(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

function splitInput(input: VerifyInput): { headers: HeadersInput; query?: QueryInput } {
  if (input && typeof input === "object" && "headers" in input && typeof input.headers === "object" && input.headers) {
    const withHeaders = input as RequestLike & HeadersAndQuery;
    const query = withHeaders.query ?? queryFromUrl(typeof withHeaders.url === "string" ? withHeaders.url : undefined);
    return query === undefined ? { headers: withHeaders.headers } : { headers: withHeaders.headers, query };
  }
  return { headers: input as HeadersInput };
}

function assertToken(token: unknown): asserts token is string {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("hotmart-webhooks: `token` must be a non-empty string (your Hotmart hottok).");
  }
}

/**
 * Like `verifyHottok`, but tells you why verification failed and where the
 * token came from. Useful for logging (never log the token itself).
 */
export function checkHottok(input: VerifyInput, options: VerifyHottokOptions): VerifyHottokResult {
  assertToken(options?.token);
  const { headers, query } = splitInput(input);

  const fromHeader = getHeader(headers, HOTTOK_HEADER);
  if (fromHeader !== undefined && fromHeader !== "") {
    return safeCompare(fromHeader, options.token)
      ? { valid: true, source: "header" }
      : { valid: false, reason: "mismatch" };
  }

  if (options.allowQueryToken) {
    const fromQuery = getQueryParam(query, HOTTOK_QUERY_PARAM);
    if (fromQuery !== undefined && fromQuery !== "") {
      return safeCompare(fromQuery, options.token)
        ? { valid: true, source: "query" }
        : { valid: false, reason: "mismatch" };
    }
  }

  return { valid: false, reason: "missing" };
}

/**
 * Check the hottok sent by Hotmart against your configured token, in constant time.
 *
 * Accepts a Web `Request`, a `Headers` instance, a Node header record, or
 * `{ headers, query }`. Returns a plain boolean so `if (!verifyHottok(...))`
 * does what it reads like. Throws `TypeError` only when `options.token` itself
 * is missing or empty (a configuration error, not a bad request).
 */
export function verifyHottok(input: VerifyInput, options: VerifyHottokOptions): boolean {
  return checkHottok(input, options).valid;
}

export { assertToken as _assertToken };
