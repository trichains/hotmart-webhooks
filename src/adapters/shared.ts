import type { HeaderRecord } from "../http.js";
import type { WebhookResponse } from "../handler.js";

/** Default request body limit for the Node and Express adapters: 1 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface BodyLimitOptions {
  /** Requests with a larger body get a 413 without being parsed. Default: 1 MiB. */
  maxBodyBytes?: number;
}

/** The parts of `http.IncomingMessage` the adapters use. */
export interface NodeRequestLike extends AsyncIterable<Uint8Array | string> {
  headers: HeaderRecord;
  url?: string;
  method?: string;
}

/** The parts of `http.ServerResponse` the adapters use. */
export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk?: string): unknown;
}

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export async function readNodeBody(req: NodeRequestLike, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    total += bytes.byteLength;
    if (total > limit) throw new BodyTooLargeError(limit);
    chunks.push(bytes);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function tooLarge(): WebhookResponse {
  return { status: 413, body: { ok: false, error: "payload_too_large" } };
}

export function sendNode(res: NodeResponseLike, response: WebhookResponse): void {
  res.statusCode = response.status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response.body));
}
