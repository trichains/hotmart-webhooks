import type { WebhookHandler } from "../handler.js";

/**
 * Turn a webhook handler into a Web-standard route handler:
 * `(request: Request) => Promise<Response>`.
 *
 * Works with Next.js App Router route handlers (`export const POST = ...`) on
 * the Node.js runtime, and with anything else that speaks Fetch API
 * (Hono, Remix/React Router actions, Bun.serve, Deno). The Edge runtime is not
 * supported because token comparison uses `node:crypto`.
 */
export function toNextRouteHandler(handler: WebhookHandler): (request: Request) => Promise<Response> {
  return async function hotmartWebhookRoute(request: Request): Promise<Response> {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const response = await handler.handle({
      headers: request.headers,
      rawBody,
      query: new URL(request.url).searchParams,
      method: request.method,
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
}

/** Alias for non-Next.js users: same function, framework-neutral name. */
export const toFetchHandler = toNextRouteHandler;
