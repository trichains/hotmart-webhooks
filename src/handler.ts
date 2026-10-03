import { getEventCategory, type EventCategory, type WebhookEventName } from "./events.js";
import type { HeadersInput, QueryInput } from "./http.js";
import { parseWebhook, type ParseIssue, type WebhookErrorCode } from "./parse.js";
import type { WebhookEvent, WebhookEventOf } from "./schemas/index.js";
import { _assertToken } from "./verify.js";

/** Structural logger: pass `console`, pino, winston, or nothing. */
export interface WebhookLogger {
  debug?(message: string, fields?: Record<string, unknown>): void;
  info?(message: string, fields?: Record<string, unknown>): void;
  warn?(message: string, fields?: Record<string, unknown>): void;
  error?(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Where processed event ids are remembered. Back it with Redis, a database
 * unique index, or `createMemoryIdempotencyStore()` for local development.
 */
export interface IdempotencyStore {
  has(id: string): boolean | Promise<boolean>;
  set(id: string): void | Promise<void>;
}

export interface HandlerContext {
  /** Category of the event being handled. */
  category: EventCategory;
  /** When this delivery was received by the handler. */
  receivedAt: Date;
  logger: WebhookLogger;
}

export type EventHandler<E extends WebhookEventName> = (
  event: WebhookEventOf<E>,
  ctx: HandlerContext,
) => unknown | Promise<unknown>;

export type WildcardHandler = (event: WebhookEvent, ctx: HandlerContext) => unknown | Promise<unknown>;

/**
 * Map of event name to handler. A specific handler wins over `"*"`; the
 * wildcard only runs for events without their own handler.
 */
export type WebhookHandlers = { [K in WebhookEventName]?: EventHandler<K> } & { "*"?: WildcardHandler };

export interface WebhookRequest {
  headers: HeadersInput;
  /** The unparsed request body. */
  rawBody: string | Uint8Array | ArrayBuffer;
  query?: QueryInput;
  /** When provided, anything other than POST gets a 405. */
  method?: string;
}

export type WebhookResponseBody =
  | {
      ok: true;
      id?: string;
      event?: string;
      /** The event id was already processed; the handler did not run again. */
      duplicate?: true;
      /** The event was acknowledged but not handled. */
      ignored?: "unsupported_event" | "no_handler";
    }
  | {
      ok: false;
      error: WebhookErrorCode | "handler_error" | "method_not_allowed" | "payload_too_large";
      issues?: ParseIssue[];
    };

export interface WebhookResponse {
  status: number;
  body: WebhookResponseBody;
}

export interface CreateWebhookHandlerOptions {
  /** Your Hotmart hottok. Read it from an environment variable. */
  token: string;
  handlers: WebhookHandlers;
  idempotency?: IdempotencyStore;
  /** Called when a handler (or the idempotency store) throws. The response is a 500 so Hotmart retries. */
  onError?: (error: unknown, info: { event?: WebhookEvent }) => void | Promise<void>;
  logger?: WebhookLogger;
  /** Accept the legacy `?hottok=` query parameter. Off by default. */
  allowQueryToken?: boolean;
}

export interface WebhookHandler {
  handle(request: WebhookRequest): Promise<WebhookResponse>;
}

const STATUS_BY_CODE: Record<WebhookErrorCode, number> = {
  invalid_token: 401,
  invalid_json: 400,
  invalid_payload: 400,
  unsupported_event: 200,
};

/**
 * Build a framework-agnostic webhook handler. Wire it to your framework with
 * one of the adapters (`/adapters/next`, `/adapters/node`, `/adapters/express`)
 * or call `handle()` yourself.
 *
 * Status codes: 200 processed / duplicate / ignored, 400 bad body,
 * 401 bad or missing token, 405 wrong method, 500 handler failure (Hotmart retries).
 */
export function createWebhookHandler(options: CreateWebhookHandlerOptions): WebhookHandler {
  _assertToken(options?.token);
  const { token, handlers, idempotency, onError, allowQueryToken = false } = options;
  const logger: WebhookLogger = options.logger ?? {};

  async function handle(request: WebhookRequest): Promise<WebhookResponse> {
    const receivedAt = new Date();

    if (request.method !== undefined && request.method.toUpperCase() !== "POST") {
      return { status: 405, body: { ok: false, error: "method_not_allowed" } };
    }

    const parsed = parseWebhook(request.rawBody, {
      token,
      headers: request.headers,
      allowQueryToken,
      ...(request.query === undefined ? {} : { query: request.query }),
    });

    if (!parsed.ok) {
      const { code, issues, event } = parsed.error;
      if (code === "unsupported_event") {
        logger.info?.("hotmart.webhook.ignored", { reason: code, event });
        return { status: 200, body: { ok: true, ...(event ? { event } : {}), ignored: "unsupported_event" } };
      }
      logger.warn?.("hotmart.webhook.rejected", { reason: code, event, issues: issues?.length });
      return {
        status: STATUS_BY_CODE[code],
        body: issues ? { ok: false, error: code, issues } : { ok: false, error: code },
      };
    }

    const event = parsed.event;
    const meta = { id: event.id, event: event.event };

    try {
      if (idempotency && (await idempotency.has(event.id))) {
        logger.info?.("hotmart.webhook.duplicate", meta);
        return { status: 200, body: { ok: true, ...meta, duplicate: true } };
      }

      const specific = handlers[event.event] as WildcardHandler | undefined;
      const fn = specific ?? handlers["*"];
      if (!fn) {
        logger.info?.("hotmart.webhook.ignored", { ...meta, reason: "no_handler" });
        return { status: 200, body: { ok: true, ...meta, ignored: "no_handler" } };
      }

      const ctx: HandlerContext = { category: getEventCategory(event.event), receivedAt, logger };
      await fn(event, ctx);
      await idempotency?.set(event.id);

      logger.info?.("hotmart.webhook.processed", { ...meta, durationMs: Date.now() - receivedAt.getTime() });
      return { status: 200, body: { ok: true, ...meta } };
    } catch (error) {
      logger.error?.("hotmart.webhook.failed", {
        ...meta,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await onError?.(error, { event });
      } catch (hookError) {
        logger.error?.("hotmart.webhook.on_error_failed", {
          ...meta,
          error: hookError instanceof Error ? hookError.message : String(hookError),
        });
      }
      return { status: 500, body: { ok: false, error: "handler_error" } };
    }
  }

  return { handle };
}
