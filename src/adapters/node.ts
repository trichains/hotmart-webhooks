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

export type { BodyLimitOptions, NodeRequestLike, NodeResponseLike } from "./shared.js";

/**
 * Turn a webhook handler into a `node:http` request listener:
 * `http.createServer(toNodeListener(handler))`.
 *
 * The listener never rejects: body-read failures become a 400, oversized bodies a 413.
 */
export function toNodeListener(
  handler: WebhookHandler,
  options: BodyLimitOptions = {},
): (req: NodeRequestLike, res: NodeResponseLike) => Promise<void> {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async function hotmartWebhookListener(req, res) {
    let rawBody: Uint8Array;
    try {
      rawBody = await readNodeBody(req, limit);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return sendNode(res, tooLarge());
      return sendNode(res, { status: 400, body: { ok: false, error: "invalid_json" } });
    }

    const query = queryFromUrl(req.url);
    const response = await handler.handle({
      headers: req.headers,
      rawBody,
      ...(query ? { query } : {}),
      ...(req.method ? { method: req.method } : {}),
    });
    sendNode(res, response);
  };
}
