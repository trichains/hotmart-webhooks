import type { z } from "zod";
import { isWebhookEventName } from "./events.js";
import { bodyToString, type HeadersInput, type QueryInput } from "./http.js";
import { webhookEventSchema, type WebhookEvent } from "./schemas/index.js";
import { checkHottok } from "./verify.js";

export type WebhookErrorCode = "invalid_token" | "invalid_json" | "invalid_payload" | "unsupported_event";

/** A validation problem, decoupled from zod's internal issue type. */
export interface ParseIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

export interface WebhookParseError {
  code: WebhookErrorCode;
  message: string;
  /** Present for `invalid_payload`. */
  issues?: ParseIssue[];
  /** The `event` value received, when there was one (useful for `unsupported_event`). */
  event?: string;
  /** The decoded JSON, for `invalid_payload` and `unsupported_event`, so you can store or inspect it. */
  payload?: unknown;
}

export type ParseResult = { ok: true; event: WebhookEvent } | { ok: false; error: WebhookParseError };

export interface ParseWebhookOptions {
  /** Your Hotmart hottok. */
  token: string;
  /** Request headers (Web `Headers`, Node `IncomingHttpHeaders` or a plain object). */
  headers: HeadersInput;
  /** Query string, only read when `allowQueryToken` is true. */
  query?: QueryInput;
  /** Accept the legacy `?hottok=` query parameter. Off by default. */
  allowQueryToken?: boolean;
}

/** Error thrown by `parseWebhookOrThrow` and `parseEventOrThrow`. */
export class HotmartWebhookError extends Error {
  readonly code: WebhookErrorCode;
  readonly issues: ParseIssue[] | undefined;
  readonly event: string | undefined;

  constructor(error: WebhookParseError) {
    super(error.message);
    this.name = "HotmartWebhookError";
    this.code = error.code;
    this.issues = error.issues;
    this.event = error.event;
  }
}

function toIssues(issues: readonly z.core.$ZodIssue[]): ParseIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment)),
    message: issue.message,
    code: issue.code,
  }));
}

function fail(error: WebhookParseError): ParseResult {
  return { ok: false, error };
}

/**
 * Validate an already-decoded payload (no token check). Use it when the token
 * was verified elsewhere, e.g. in a queue worker processing stored events.
 */
export function parseEvent(payload: unknown): ParseResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return fail({ code: "invalid_payload", message: "Payload must be a JSON object.", payload, issues: [] });
  }

  const eventName = (payload as { event?: unknown }).event;
  if (typeof eventName !== "string" || eventName.length === 0) {
    return fail({
      code: "invalid_payload",
      message: "Payload has no `event` field.",
      payload,
      issues: [{ path: ["event"], message: "Expected a non-empty string", code: "invalid_type" }],
    });
  }

  if (!isWebhookEventName(eventName)) {
    return fail({
      code: "unsupported_event",
      message: `Event "${eventName}" is not supported by this version of @trichains/hotmart-webhooks.`,
      event: eventName,
      payload,
    });
  }

  const result = webhookEventSchema.safeParse(payload);
  if (!result.success) {
    return fail({
      code: "invalid_payload",
      message: `Payload does not match the ${eventName} schema.`,
      event: eventName,
      issues: toIssues(result.error.issues),
      payload,
    });
  }
  return { ok: true, event: result.data };
}

/**
 * Verify the hottok and parse a raw webhook body into a typed event.
 *
 * Never throws for bad requests; inspect `result.ok`. The token is checked
 * before the body is decoded, so unauthenticated requests never reach JSON.parse.
 */
export function parseWebhook(rawBody: string | Uint8Array | ArrayBuffer, options: ParseWebhookOptions): ParseResult {
  const auth = checkHottok(
    options.query === undefined ? { headers: options.headers } : { headers: options.headers, query: options.query },
    { token: options.token, allowQueryToken: options.allowQueryToken ?? false },
  );
  if (!auth.valid) {
    return fail({
      code: "invalid_token",
      message: auth.reason === "missing" ? "Missing X-HOTMART-HOTTOK header." : "Invalid hottok.",
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyToString(rawBody));
  } catch {
    return fail({ code: "invalid_json", message: "Request body is not valid JSON." });
  }

  return parseEvent(payload);
}

/** Same as `parseWebhook`, but throws `HotmartWebhookError` instead of returning `{ ok: false }`. */
export function parseWebhookOrThrow(
  rawBody: string | Uint8Array | ArrayBuffer,
  options: ParseWebhookOptions,
): WebhookEvent {
  const result = parseWebhook(rawBody, options);
  if (!result.ok) throw new HotmartWebhookError(result.error);
  return result.event;
}

/** Same as `parseEvent`, but throws `HotmartWebhookError`. */
export function parseEventOrThrow(payload: unknown): WebhookEvent {
  const result = parseEvent(payload);
  if (!result.ok) throw new HotmartWebhookError(result.error);
  return result.event;
}
