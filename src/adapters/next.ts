import type { WebhookHandler, WebhookResponse } from "../handler.js";
import { BodyTooLargeError, DEFAULT_MAX_BODY_BYTES, tooLarge, type BodyLimitOptions } from "./shared.js";

export type { BodyLimitOptions } from "./shared.js";

async function readRequestBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLargeError(limit);
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new BodyTooLargeError(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function toResponse(response: WebhookResponse): Response {
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Turn a webhook handler into a Web-standard route handler:
 * `(request: Request) => Promise<Response>`.
 *
 * Works with Next.js App Router route handlers (`export const POST = ...`) on
 * the Node.js runtime, and with anything else that speaks Fetch API
 * (Hono, Remix/React Router actions, Bun.serve; untested). The Edge runtime is not
 * supported because token comparison uses `node:crypto`.
 *
 * Bodies above `maxBodyBytes` (default 1 MiB) get a 413; a body that cannot be
 * read gets a 400.
 */
export function toNextRouteHandler(
  handler: WebhookHandler,
  options: BodyLimitOptions = {},
): (request: Request) => Promise<Response> {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async function hotmartWebhookRoute(request: Request): Promise<Response> {
    let rawBody: Uint8Array;
    try {
      rawBody = await readRequestBody(request, limit);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return toResponse(tooLarge());
      return toResponse({ status: 400, body: { ok: false, error: "invalid_json" } });
    }
    const response = await handler.handle({
      headers: request.headers,
      rawBody,
      query: new URL(request.url).searchParams,
      method: request.method,
    });
    return toResponse(response);
  };
}

/** Alias for non-Next.js users: same function, framework-neutral name. */
export const toFetchHandler = toNextRouteHandler;
