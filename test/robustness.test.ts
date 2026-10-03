import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { toExpressMiddleware } from "../src/adapters/express.js";
import { toNextRouteHandler } from "../src/adapters/next.js";
import { toNodeListener } from "../src/adapters/node.js";
import { runCli } from "../src/cli/run.js";
import {
  HotmartWebhookError,
  createWebhookHandler,
  parseEvent,
  stripNulls,
  toDate,
  toMinorUnits,
  verifyHottok,
  type WebhookParseError,
} from "../src/index.js";
import { createFixture, fixtures } from "../src/fixtures/index.js";

const token = "test-hottok-123";
const headers = { "x-hotmart-hottok": token };
const body = JSON.stringify(fixtures.PURCHASE_APPROVED);

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as string | undefined,
    setHeader() {},
    end(chunk?: string) {
      this.body = chunk;
    },
  };
}

describe("null values", () => {
  it("treats null optional fields as absent", () => {
    const payload = JSON.parse(body);
    payload.data.buyer.checkout_phone = null;
    payload.data.buyer.document = null;
    payload.data.purchase.offer.coupon_code = null;
    payload.data.purchase.origin = { sck: null, src: null, xcod: null };
    payload.data.subscription = null;
    payload.data.affiliates = [{ affiliate_code: null, name: "A" }];
    const result = parseEvent(payload);
    expect(result.ok, JSON.stringify(!result.ok && result.error.issues)).toBe(true);
    if (result.ok && result.event.event === "PURCHASE_APPROVED") {
      expect(result.event.data.buyer?.checkout_phone).toBeUndefined();
      expect(result.event.data.subscription).toBeUndefined();
    }
  });

  it("still rejects null required fields and null array items", () => {
    const payload = JSON.parse(body);
    payload.data.purchase.transaction = null;
    const result = parseEvent(payload);
    expect(!result.ok && result.error.issues?.[0]?.path).toEqual(["data", "purchase", "transaction"]);

    const withNullItem = JSON.parse(body);
    withNullItem.data.affiliates = [null];
    expect(parseEvent(withNullItem).ok).toBe(false);
  });

  it("stripNulls does not mutate its input", () => {
    const input = { a: null, b: { c: null, d: 1 }, e: [null, { f: null }] };
    expect(stripNulls(input)).toEqual({ b: { d: 1 }, e: [null, {}] });
    expect(input.a).toBeNull();
  });
});

describe("handler robustness", () => {
  it("a throwing logger never changes the response", async () => {
    const boom = () => {
      throw new Error("logger boom");
    };
    const handler = createWebhookHandler({
      token,
      handlers: {
        "*": (_event, ctx) => {
          ctx.logger.info?.("from handler");
        },
      },
      logger: { info: boom, warn: boom, error: boom, debug: boom },
    });
    expect((await handler.handle({ headers, rawBody: body })).status).toBe(200);
    expect((await handler.handle({ headers: {}, rawBody: body })).status).toBe(401);
    const unknown = JSON.stringify({ ...fixtures.SWITCH_PLAN, event: "X" });
    expect((await handler.handle({ headers, rawBody: unknown })).status).toBe(200);
  });

  it("an idempotency.set failure after success still answers 200 and is logged", async () => {
    const lines: string[] = [];
    const handler = createWebhookHandler({
      token,
      handlers: { "*": () => {} },
      idempotency: { has: () => false, set: () => Promise.reject(new Error("redis down")) },
      logger: { error: (m) => void lines.push(m), info: (m) => void lines.push(m) },
    });
    const res = await handler.handle({ headers, rawBody: body });
    expect(res.status).toBe(200);
    expect(lines).toEqual(["hotmart.webhook.idempotency_set_failed", "hotmart.webhook.processed"]);
  });

  it("onInvalidPayload receives authenticated bad payloads only", async () => {
    const seen: WebhookParseError[] = [];
    const handler = createWebhookHandler({ token, handlers: {}, onInvalidPayload: (e) => void seen.push(e) });
    const bad = createFixture("PURCHASE_APPROVED");
    (bad.data.purchase as Record<string, unknown>).status = 1;
    await handler.handle({ headers, rawBody: JSON.stringify(bad) });
    await handler.handle({ headers, rawBody: "{" });
    await handler.handle({ headers: {}, rawBody: JSON.stringify(bad) });
    expect(seen.map((e) => e.code)).toEqual(["invalid_payload", "invalid_json"]);
    expect(seen[0]!.payload).toMatchObject({ event: "PURCHASE_APPROVED" });
  });

  it("a throwing onInvalidPayload is logged and ignored", async () => {
    const lines: string[] = [];
    const handler = createWebhookHandler({
      token,
      handlers: {},
      onInvalidPayload: () => {
        throw new Error("x");
      },
      logger: { error: (m) => void lines.push(m) },
    });
    expect((await handler.handle({ headers, rawBody: "{" })).status).toBe(400);
    expect(lines).toEqual(["hotmart.webhook.on_invalid_payload_failed"]);
  });

  it("logs issue paths", async () => {
    const fields: Record<string, unknown>[] = [];
    const handler = createWebhookHandler({ token, handlers: {}, logger: { warn: (_m, f) => void fields.push(f!) } });
    const bad = createFixture("PURCHASE_APPROVED");
    (bad.data.purchase as Record<string, unknown>).status = 1;
    await handler.handle({ headers, rawBody: JSON.stringify(bad) });
    expect(fields[0]).toMatchObject({
      reason: "invalid_payload",
      issueCount: 1,
      issues: [expect.stringMatching(/^data\.purchase\.status: /)],
    });
  });
});

describe("token whitespace", () => {
  it("trims the configured and the received token", () => {
    expect(verifyHottok({ "x-hotmart-hottok": token }, { token: `${token}\n` })).toBe(true);
    expect(verifyHottok({ "x-hotmart-hottok": ` ${token} ` }, { token })).toBe(true);
    expect(() => verifyHottok({}, { token: "  \n" })).toThrow(TypeError);
  });
});

describe("adapter robustness", () => {
  it("node listener answers 500 when a custom handler rejects", async () => {
    const res = mockRes();
    const req = Object.assign(Readable.from([body]), { headers, url: "/", method: "POST" });
    await toNodeListener({ handle: () => Promise.reject(new Error("x")) })(req, res);
    expect(res.statusCode).toBe(500);
  });

  it("express: an unparsed {} body (body-parser 1.x skipped it) falls back to the stream", async () => {
    const seen: string[] = [];
    const handler = createWebhookHandler({ token, handlers: { "*": (e) => void seen.push(e.event) } });
    const res = mockRes();
    const req = Object.assign(Readable.from([body]), { headers, url: "/", method: "POST", body: {} });
    await toExpressMiddleware(handler)(req, res);
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual(["PURCHASE_APPROVED"]);
  });

  it("express: trusts a parsed object body flagged by body-parser 1.x", async () => {
    const handler = createWebhookHandler({ token, handlers: {} });
    const res = mockRes();
    const req = Object.assign(Readable.from([]), {
      headers,
      url: "/",
      method: "POST",
      body: JSON.parse(body),
      _body: true,
    });
    await toExpressMiddleware(handler)(req, res);
    expect(res.statusCode).toBe(200);
  });

  it("next: rejects by declared content-length before reading", async () => {
    const POST = toNextRouteHandler(createWebhookHandler({ token, handlers: {} }), { maxBodyBytes: 10 });
    const request = new Request("http://localhost/api/hotmart", {
      method: "POST",
      headers: { ...headers, "content-length": String(body.length) },
      body,
    });
    expect(request.headers.get("content-length")).toBe(String(body.length));
    expect((await POST(request)).status).toBe(413);
  });
});

describe("helper edge cases", () => {
  it("toDate is strict about strings and reads offset-less date-times as UTC", () => {
    expect(toDate(" 12 ")).toBeNull();
    expect(toDate("12/01/2024")).toBeNull();
    expect(toDate(0)).toBeNull();
    expect(toDate(-5)).toBeNull();
    expect(toDate("0")).toBeNull();
    expect(toDate("2025-03-15T00:00:00")?.toISOString()).toBe("2025-03-15T00:00:00.000Z");
    expect(toDate("2024-01-01 10:00:00")?.toISOString()).toBe("2024-01-01T10:00:00.000Z");
    expect(toDate("2024-01-01T10:00:00-03:00")?.toISOString()).toBe("2024-01-01T13:00:00.000Z");
    expect(toDate("2024-01-01")?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(toDate("2024-13-45")).toBeNull();
  });

  it("toMinorUnits rejects amounts beyond safe integers", () => {
    expect(() => toMinorUnits(1e21, "BRL")).toThrow(RangeError);
  });

  it("HotmartWebhookError.is checks the shape, not only instanceof", () => {
    const real = new HotmartWebhookError({ code: "invalid_json", message: "x" });
    const foreign = Object.assign(new Error("x"), { name: "HotmartWebhookError", code: "invalid_json" });
    expect(HotmartWebhookError.is(real)).toBe(true);
    expect(HotmartWebhookError.is(foreign)).toBe(true);
    expect(HotmartWebhookError.is(new Error("x"))).toBe(false);
    expect(HotmartWebhookError.is("nope")).toBe(false);
  });

  it("fixtures are deeply frozen", () => {
    expect(Object.isFrozen(fixtures.PURCHASE_APPROVED.data.purchase)).toBe(true);
    expect(() => {
      (fixtures.PURCHASE_APPROVED.data.purchase as Record<string, unknown>).status = "X";
    }).toThrow(TypeError);
  });
});

describe("CLI", () => {
  it("reports a failure while reading the response body instead of crashing", async () => {
    const err: string[] = [];
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.reject(new Error("aborted")),
    } as unknown as Response;
    const code = await runCli(["send", "-e", "SWITCH_PLAN", "-u", "http://localhost/h", "-t", "x"], {
      fetch: vi.fn(async () => response),
      stdout: () => {},
      stderr: (t) => void err.push(t),
      env: {},
      version: "0",
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("request failed: aborted");
  });
});
