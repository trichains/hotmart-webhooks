import type { WebhookHandler } from "../handler.js";
import { queryFromUrl } from "../http.js";
import {
  BodyTooLargeError,
  DEFAULT_MAX_BODY_BYTES,
  readNodeBody,
  sendNode,
  tooLarge,
  type BodyLimitOptions,
  type NodeRequestLike,
  type NodeResponseLike,
} from "./shared.js";

export type { BodyLimitOptions, NodeResponseLike } from "./shared.js";

/** The parts of an Express (or Connect-style) request the middleware reads. */
export interface ExpressRequestLike extends NodeRequestLike {
  /** Set by some setups (e.g. `express.json({ verify })` storing the buffer). */
  rawBody?: unknown;
  /** `express.raw()` gives a Buffer, `express.text()` a string, `express.json()` an object. */
  body?: unknown;
  originalUrl?: string;
}

export type NextFunctionLike = (error?: unknown) => void;

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

async function resolveBody(req: ExpressRequestLike, limit: number): Promise<Uint8Array | string> {
  if (isBytes(req.rawBody) || typeof req.rawBody === "string") return req.rawBody;
  if (isBytes(req.body) || typeof req.body === "string") return req.body;
  // Body already parsed by express.json(). Hotmart does not sign the body (the
  // hottok is a static header), so re-serialising does not weaken verification.
  if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }
  return readNodeBody(req, limit);
}

/**
 * Turn a webhook handler into Express middleware:
 * `app.post("/webhooks/hotmart", toExpressMiddleware(handler))`.
 *
 * Works with or without a body parser in front of it: it uses `req.rawBody`,
 * a Buffer/string `req.body`, a parsed JSON `req.body`, or reads the stream.
 * Unexpected errors are passed to `next(err)` when `next` is available.
 */
export function toExpressMiddleware(
  handler: WebhookHandler,
  options: BodyLimitOptions = {},
): (req: ExpressRequestLike, res: NodeResponseLike, next?: NextFunctionLike) => Promise<void> {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async function hotmartWebhookMiddleware(req, res, next) {
    try {
      let rawBody: Uint8Array | string;
      try {
        rawBody = await resolveBody(req, limit);
      } catch (error) {
        if (error instanceof BodyTooLargeError) return sendNode(res, tooLarge());
        throw error;
      }

      const query = queryFromUrl(req.originalUrl ?? req.url);
      const response = await handler.handle({
        headers: req.headers,
        rawBody,
        ...(query ? { query } : {}),
        ...(req.method ? { method: req.method } : {}),
      });
      sendNode(res, response);
    } catch (error) {
      if (next) return next(error);
      sendNode(res, { status: 500, body: { ok: false, error: "handler_error" } });
    }
  };
}
