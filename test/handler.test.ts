import { describe, expect, it, vi } from "vitest";
import { createMemoryIdempotencyStore, createWebhookHandler, type WebhookLogger } from "../src/index.js";
import { createFixture, fixtures } from "../src/fixtures/index.js";

const token = "test-hottok-123";
const headers = { "x-hotmart-hottok": token };
const bodyOf = (value: unknown) => JSON.stringify(value);

function makeLogger() {
  const lines: { level: string; message: string; fields?: Record<string, unknown> }[] = [];
  const logger: WebhookLogger = {
    debug: (message, fields) => lines.push({ level: "debug", message, fields }),
    info: (message, fields) => lines.push({ level: "info", message, fields }),
    warn: (message, fields) => lines.push({ level: "warn", message, fields }),
    error: (message, fields) => lines.push({ level: "error", message, fields }),
  };
  return { logger, lines };
}

describe("createWebhookHandler", () => {
  it("throws on a missing token (configuration error)", () => {
    expect(() => createWebhookHandler({ token: "", handlers: {} })).toThrow(TypeError);
  });

  it("routes to the specific handler and skips the wildcard", async () => {
    const approved = vi.fn();
    const wildcard = vi.fn();
    const handler = createWebhookHandler({ token, handlers: { PURCHASE_APPROVED: approved, "*": wildcard } });

    const res = await handler.handle({ headers, rawBody: bodyOf(fixtures.PURCHASE_APPROVED) });

    expect(res).toEqual({
      status: 200,
      body: { ok: true, id: fixtures.PURCHASE_APPROVED.id, event: "PURCHASE_APPROVED" },
    });
    expect(approved).toHaveBeenCalledOnce();
    expect(wildcard).not.toHaveBeenCalled();
    const [event, ctx] = approved.mock.calls[0]!;
    expect(event.data.purchase.transaction).toBe("HP0000000001");
    expect(ctx.category).toBe("purchase");
    expect(ctx.receivedAt).toBeInstanceOf(Date);
  });

  it("falls back to the wildcard for events without a specific handler", async () => {
    const wildcard = vi.fn();
    const handler = createWebhookHandler({ token, handlers: { PURCHASE_APPROVED: vi.fn(), "*": wildcard } });
    const res = await handler.handle({ headers, rawBody: bodyOf(fixtures.CLUB_FIRST_ACCESS) });
    expect(res.status).toBe(200);
    expect(wildcard).toHaveBeenCalledOnce();
    expect(wildcard.mock.calls[0]![1].category).toBe("club");
  });

  it("acknowledges events with no handler at all", async () => {
    const handler = createWebhookHandler({ token, handlers: {} });
    const res = await handler.handle({ headers, rawBody: bodyOf(fixtures.SWITCH_PLAN) });
    expect(res).toEqual({
      status: 200,
      body: { ok: true, id: fixtures.SWITCH_PLAN.id, event: "SWITCH_PLAN", ignored: "no_handler" },
    });
  });

  it("acknowledges unsupported events with 200 so Hotmart stops retrying", async () => {
    const wildcard = vi.fn();
    const handler = createWebhookHandler({ token, handlers: { "*": wildcard } });
    const payload = { ...fixtures.CLUB_FIRST_ACCESS, event: "CLUB_SOMETHING_NEW" };
    const res = await handler.handle({ headers, rawBody: bodyOf(payload) });
    expect(res).toEqual({ status: 200, body: { ok: true, event: "CLUB_SOMETHING_NEW", ignored: "unsupported_event" } });
    expect(wildcard).not.toHaveBeenCalled();
  });

  it.each([
    ["missing token", {}, bodyOf(fixtures.PURCHASE_APPROVED), 401, "invalid_token"],
    ["wrong token", { "x-hotmart-hottok": "nope" }, bodyOf(fixtures.PURCHASE_APPROVED), 401, "invalid_token"],
    ["invalid JSON", headers, "{", 400, "invalid_json"],
  ] as const)("rejects %s", async (_name, reqHeaders, rawBody, status, error) => {
    const fn = vi.fn();
    const handler = createWebhookHandler({ token, handlers: { "*": fn } });
    const res = await handler.handle({ headers: reqHeaders, rawBody });
    expect(res).toEqual({ status, body: { ok: false, error } });
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads with 400 and the issues", async () => {
    const handler = createWebhookHandler({ token, handlers: {} });
    const payload = createFixture("PURCHASE_APPROVED");
    (payload.data.purchase as Record<string, unknown>).transaction = 123;
    const res = await handler.handle({ headers, rawBody: bodyOf(payload) });
    expect(res.status).toBe(400);
    expect(res.body.ok === false && res.body.issues?.[0]?.path).toEqual(["data", "purchase", "transaction"]);
  });

  it("returns 405 for non-POST methods when the method is known", async () => {
    const handler = createWebhookHandler({ token, handlers: {} });
    expect((await handler.handle({ headers, rawBody: "", method: "GET" })).status).toBe(405);
    expect((await handler.handle({ headers, rawBody: bodyOf(fixtures.PURCHASE_APPROVED), method: "post" })).status).toBe(
      200,
    );
  });

  it("passes the legacy query option through", async () => {
    const strict = createWebhookHandler({ token, handlers: {} });
    const legacy = createWebhookHandler({ token, handlers: {}, allowQueryToken: true });
    const req = { headers: {}, rawBody: bodyOf(fixtures.PURCHASE_APPROVED), query: { hottok: token } };
    expect((await strict.handle(req)).status).toBe(401);
    expect((await legacy.handle(req)).status).toBe(200);
  });

  describe("idempotency", () => {
    it("skips already processed ids and only marks them after success", async () => {
      const store = createMemoryIdempotencyStore();
      const fn = vi.fn();
      const handler = createWebhookHandler({ token, handlers: { PURCHASE_APPROVED: fn }, idempotency: store });
      const req = { headers, rawBody: bodyOf(fixtures.PURCHASE_APPROVED) };

      expect((await handler.handle(req)).body).toEqual({
        ok: true,
        id: fixtures.PURCHASE_APPROVED.id,
        event: "PURCHASE_APPROVED",
      });
      expect((await handler.handle(req)).body).toEqual({
        ok: true,
        id: fixtures.PURCHASE_APPROVED.id,
        event: "PURCHASE_APPROVED",
        duplicate: true,
      });
      expect(fn).toHaveBeenCalledOnce();
    });

    it("does not mark failed deliveries, so the retry runs the handler again", async () => {
      const store = createMemoryIdempotencyStore();
      const fn = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(undefined);
      const handler = createWebhookHandler({ token, handlers: { PURCHASE_APPROVED: fn }, idempotency: store });
      const req = { headers, rawBody: bodyOf(fixtures.PURCHASE_APPROVED) };

      expect((await handler.handle(req)).status).toBe(500);
      expect(store.has(fixtures.PURCHASE_APPROVED.id)).toBe(false);
      expect((await handler.handle(req)).status).toBe(200);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("works with async stores", async () => {
      const ids = new Set<string>();
      const store = { has: async (id: string) => ids.has(id), set: async (id: string) => void ids.add(id) };
      const handler = createWebhookHandler({ token, handlers: { "*": () => {} }, idempotency: store });
      await handler.handle({ headers, rawBody: bodyOf(fixtures.SWITCH_PLAN) });
      expect(ids.has(fixtures.SWITCH_PLAN.id)).toBe(true);
    });

    it("returns 500 when the store itself fails", async () => {
      const onError = vi.fn();
      const store = { has: () => Promise.reject(new Error("redis down")), set: () => {} };
      const handler = createWebhookHandler({ token, handlers: { "*": vi.fn() }, idempotency: store, onError });
      const res = await handler.handle({ headers, rawBody: bodyOf(fixtures.SWITCH_PLAN) });
      expect(res).toEqual({ status: 500, body: { ok: false, error: "handler_error" } });
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe("errors and logging", () => {
    it("calls onError with the event and returns 500 on handler failure", async () => {
      const onError = vi.fn();
      const { logger, lines } = makeLogger();
      const boom = new Error("boom");
      const handler = createWebhookHandler({
        token,
        handlers: {
          PURCHASE_REFUNDED: () => {
            throw boom;
          },
        },
        onError,
        logger,
      });
      const res = await handler.handle({ headers, rawBody: bodyOf(fixtures.PURCHASE_REFUNDED) });
      expect(res).toEqual({ status: 500, body: { ok: false, error: "handler_error" } });
      expect(onError).toHaveBeenCalledWith(boom, { event: expect.objectContaining({ event: "PURCHASE_REFUNDED" }) });
      expect(lines).toContainEqual(
        expect.objectContaining({ level: "error", message: "hotmart.webhook.failed", fields: expect.objectContaining({ error: "boom" }) }),
      );
    });

    it("survives a throwing onError hook and non-Error throws", async () => {
      const { logger, lines } = makeLogger();
      const handler = createWebhookHandler({
        token,
        handlers: {
          "*": () => {
            throw "plain string";
          },
        },
        onError: () => {
          throw new Error("hook broke");
        },
        logger,
      });
      const res = await handler.handle({ headers, rawBody: bodyOf(fixtures.CLUB_FIRST_ACCESS) });
      expect(res.status).toBe(500);
      expect(lines.map((l) => l.message)).toEqual(["hotmart.webhook.failed", "hotmart.webhook.on_error_failed"]);
      expect(lines[0]!.fields!.error).toBe("plain string");
    });

    it("logs a non-Error thrown by onError", async () => {
      const { logger, lines } = makeLogger();
      const handler = createWebhookHandler({
        token,
        handlers: {
          "*": () => {
            throw new Error("x");
          },
        },
        onError: () => {
          throw 42;
        },
        logger,
      });
      await handler.handle({ headers, rawBody: bodyOf(fixtures.CLUB_FIRST_ACCESS) });
      expect(lines[1]!.fields!.error).toBe("42");
    });

    it("writes structured log lines without leaking the token", async () => {
      const { logger, lines } = makeLogger();
      const handler = createWebhookHandler({ token, handlers: { "*": () => {} }, logger });
      await handler.handle({ headers, rawBody: bodyOf(fixtures.PURCHASE_APPROVED) });
      await handler.handle({ headers: {}, rawBody: bodyOf(fixtures.PURCHASE_APPROVED) });
      await handler.handle({ headers, rawBody: bodyOf({ ...fixtures.SWITCH_PLAN, event: "NEW_ONE" }) });
      expect(lines.map((l) => `${l.level}:${l.message}`)).toEqual([
        "info:hotmart.webhook.processed",
        "warn:hotmart.webhook.rejected",
        "info:hotmart.webhook.ignored",
      ]);
      expect(JSON.stringify(lines)).not.toContain(token);
      expect(lines[0]!.fields).toMatchObject({ id: fixtures.PURCHASE_APPROVED.id, event: "PURCHASE_APPROVED" });
      expect(typeof lines[0]!.fields!.durationMs).toBe("number");
    });

    it("works with a partial logger", async () => {
      const handler = createWebhookHandler({ token, handlers: {}, logger: { info: () => {} } });
      expect((await handler.handle({ headers: {}, rawBody: "" })).status).toBe(401);
    });
  });
});

describe("createMemoryIdempotencyStore", () => {
  it("expires entries after the TTL", () => {
    let now = 1_000;
    const store = createMemoryIdempotencyStore({ ttlMs: 100, now: () => now });
    store.set("a");
    expect(store.has("a")).toBe(true);
    now += 100;
    expect(store.has("a")).toBe(false);
    expect(store.size()).toBe(0);
  });

  it("evicts the oldest entries past maxEntries", () => {
    const store = createMemoryIdempotencyStore({ maxEntries: 2 });
    store.set("a");
    store.set("b");
    store.set("c");
    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(true);
    expect(store.has("c")).toBe(true);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it("re-setting an id refreshes its position", () => {
    const store = createMemoryIdempotencyStore({ maxEntries: 2 });
    store.set("a");
    store.set("b");
    store.set("a");
    store.set("c");
    expect(store.has("a")).toBe(true);
    expect(store.has("b")).toBe(false);
  });
});
