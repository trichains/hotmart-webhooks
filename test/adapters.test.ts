import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toExpressMiddleware } from "../src/adapters/express.js";
import { toFetchHandler, toNextRouteHandler } from "../src/adapters/next.js";
import { toNodeListener } from "../src/adapters/node.js";
import type { NodeResponseLike } from "../src/adapters/shared.js";
import { createWebhookHandler } from "../src/index.js";
import { createFixtureRequest, fixtures } from "../src/fixtures/index.js";

const token = "test-hottok-123";
const body = JSON.stringify(fixtures.PURCHASE_APPROVED);

function makeHandler() {
  const seen: string[] = [];
  const handler = createWebhookHandler({
    token,
    handlers: { "*": (event) => void seen.push(event.event) },
  });
  return { handler, seen };
}

/** Mock IncomingMessage: an async-iterable stream plus headers/url/method. */
function mockReq(opts: { body?: string | (string | Uint8Array)[]; headers?: Record<string, string>; url?: string; method?: string; extra?: Record<string, unknown> }) {
  const chunks = Array.isArray(opts.body) ? opts.body : opts.body === undefined ? [] : [opts.body];
  return Object.assign(Readable.from(chunks), {
    headers: opts.headers ?? {},
    url: opts.url ?? "/api/hotmart",
    method: opts.method ?? "POST",
    ...opts.extra,
  });
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      this.body = chunk;
    },
  };
  return res satisfies NodeResponseLike;
}

describe("toNextRouteHandler (Web Request -> Response)", () => {
  it("processes a valid request", async () => {
    const { handler, seen } = makeHandler();
    const POST = toNextRouteHandler(handler);
    const res = await POST(createFixtureRequest("PURCHASE_APPROVED", { token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true, id: fixtures.PURCHASE_APPROVED.id, event: "PURCHASE_APPROVED" });
    expect(seen).toEqual(["PURCHASE_APPROVED"]);
  });

  it("rejects a bad token with 401", async () => {
    const POST = toNextRouteHandler(makeHandler().handler);
    const res = await POST(createFixtureRequest("PURCHASE_APPROVED", { token: "wrong" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_token" });
  });

  it("reads the legacy query token from the URL when enabled", async () => {
    const handler = createWebhookHandler({ token, handlers: {}, allowQueryToken: true });
    const res = await toFetchHandler(handler)(
      new Request(`http://localhost/api/hotmart?hottok=${token}`, { method: "POST", body }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 413 for bodies above maxBodyBytes (no content-length, string or stream body)", async () => {
    const POST = toNextRouteHandler(makeHandler().handler, { maxBodyBytes: 100 });
    // A string body in undici has no content-length header, so this exercises the streaming limit.
    const fromString = await POST(createFixtureRequest("PURCHASE_APPROVED", { token }));
    expect(fromString.status).toBe(413);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const chunked = await POST(
      new Request("http://localhost/api/hotmart", { method: "POST", body: stream, duplex: "half" } as RequestInit),
    );
    expect(chunked.status).toBe(413);
    expect(await chunked.json()).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("returns 400 when the body stream errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("client went away"));
      },
    });
    const res = await toNextRouteHandler(makeHandler().handler)(
      new Request("http://localhost/api/hotmart", { method: "POST", body: stream, duplex: "half" } as RequestInit),
    );
    expect(res.status).toBe(400);
  });

  it("returns 405 for GET", async () => {
    const res = await toNextRouteHandler(makeHandler().handler)(new Request("http://localhost/api/hotmart"));
    expect(res.status).toBe(405);
  });
});

describe("toNodeListener (mock req/res)", () => {
  it("processes a chunked body", async () => {
    const { handler, seen } = makeHandler();
    const listener = toNodeListener(handler);
    const res = mockRes();
    const half = Math.floor(body.length / 2);
    await listener(
      mockReq({ body: [body.slice(0, half), new TextEncoder().encode(body.slice(half))], headers: { "x-hotmart-hottok": token } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body!)).toMatchObject({ ok: true, event: "PURCHASE_APPROVED" });
    expect(seen).toEqual(["PURCHASE_APPROVED"]);
  });

  it("returns 413 above maxBodyBytes", async () => {
    const res = mockRes();
    await toNodeListener(makeHandler().handler, { maxBodyBytes: 10 })(
      mockReq({ body, headers: { "x-hotmart-hottok": token } }),
      res,
    );
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body!)).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("returns 400 when the stream errors", async () => {
    const res = mockRes();
    const broken = Object.assign(
      new Readable({
        read() {
          this.destroy(new Error("socket hang up"));
        },
      }),
      { headers: { "x-hotmart-hottok": token }, url: "/", method: "POST" },
    );
    await toNodeListener(makeHandler().handler)(broken, res);
    expect(res.statusCode).toBe(400);
  });

  it("handles requests without url/method and the legacy query", async () => {
    const handler = createWebhookHandler({ token, handlers: {}, allowQueryToken: true });
    const res = mockRes();
    const req = Object.assign(Readable.from([body]), { headers: {} });
    await toNodeListener(handler)(req, res);
    expect(res.statusCode).toBe(401);

    const res2 = mockRes();
    await toNodeListener(handler)(mockReq({ body, url: `/hook?hottok=${token}` }), res2);
    expect(res2.statusCode).toBe(200);
  });
});

describe("real servers", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) {
      server.close();
      await once(server, "close");
      server = undefined;
    }
  });

  // Typed as RequestListener on purpose: this proves `createServer(toNodeListener(h))` typechecks.
  async function listen(listener: RequestListener): Promise<string> {
    server = createServer(listener);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const post = (url: string, init: RequestInit = {}) =>
    fetch(url, { method: "POST", body, headers: { "x-hotmart-hottok": token, "content-type": "application/json" }, ...init });

  it("node:http + toNodeListener", async () => {
    const { handler, seen } = makeHandler();
    const base = await listen(toNodeListener(handler));
    const res = await post(`${base}/api/hotmart`);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["PURCHASE_APPROVED"]);
  });

  it("express without a body parser (reads the stream)", async () => {
    const { handler, seen } = makeHandler();
    const app = express();
    app.post("/hook", toExpressMiddleware(handler));
    const base = await listen(app);
    expect((await post(`${base}/hook`)).status).toBe(200);
    expect(seen).toEqual(["PURCHASE_APPROVED"]);
  });

  it("express with express.json() in front", async () => {
    const { handler, seen } = makeHandler();
    const app = express();
    app.use(express.json());
    app.post("/hook", toExpressMiddleware(handler));
    const base = await listen(app);
    expect((await post(`${base}/hook`)).status).toBe(200);
    expect(seen).toEqual(["PURCHASE_APPROVED"]);
  });

  it("express with express.raw() and a bad token", async () => {
    const app = express();
    app.use(express.raw({ type: "*/*" }));
    app.post("/hook", toExpressMiddleware(makeHandler().handler));
    const base = await listen(app);
    const res = await post(`${base}/hook`, { headers: { "x-hotmart-hottok": "nope" } });
    expect(res.status).toBe(401);
  });
});

describe("toExpressMiddleware (mock req/res)", () => {
  it("prefers req.rawBody, then string/Buffer req.body", async () => {
    const { handler, seen } = makeHandler();
    const mw = toExpressMiddleware(handler);
    const headers = { "x-hotmart-hottok": token };

    const res1 = mockRes();
    await mw(mockReq({ headers, extra: { rawBody: Buffer.from(body), body: { ignored: true } } }), res1);
    const res2 = mockRes();
    await mw(mockReq({ headers, extra: { body } }), res2);
    const res3 = mockRes();
    await mw(mockReq({ headers, extra: { rawBody: body } }), res3);

    expect([res1.statusCode, res2.statusCode, res3.statusCode]).toEqual([200, 200, 200]);
    expect(seen).toHaveLength(3);
  });

  it("uses originalUrl for the legacy query", async () => {
    const handler = createWebhookHandler({ token, handlers: {}, allowQueryToken: true });
    const res = mockRes();
    await toExpressMiddleware(handler)(mockReq({ body, url: "/", extra: { originalUrl: `/hook?hottok=${token}` } }), res);
    expect(res.statusCode).toBe(200);
  });

  it("returns 413 for oversized streamed bodies", async () => {
    const res = mockRes();
    await toExpressMiddleware(makeHandler().handler, { maxBodyBytes: 5 })(mockReq({ body }), res);
    expect(res.statusCode).toBe(413);
  });

  it("forwards unexpected errors to next(), or answers 500 without next", async () => {
    const failing = { handle: () => Promise.reject(new Error("unexpected")) };
    const next = vi.fn();
    await toExpressMiddleware(failing)(mockReq({ body }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));

    const res = mockRes();
    await toExpressMiddleware(failing)(mockReq({ body }), res);
    expect(res.statusCode).toBe(500);
  });

  it("forwards stream errors to next()", async () => {
    const next = vi.fn();
    const broken = Object.assign(
      new Readable({
        read() {
          this.destroy(new Error("aborted"));
        },
      }),
      { headers: {}, url: "/", method: "POST" },
    );
    await toExpressMiddleware(makeHandler().handler)(broken, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "aborted" }));
  });

  it("handles requests without method or url", async () => {
    const res = mockRes();
    const req = Object.assign(Readable.from([]), { headers: {}, body });
    await toExpressMiddleware(makeHandler().handler)(req, res);
    expect(res.statusCode).toBe(401);
  });
});
