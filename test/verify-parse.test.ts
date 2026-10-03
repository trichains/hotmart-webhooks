import { describe, expect, it } from "vitest";
import {
  HotmartWebhookError,
  checkHottok,
  parseEvent,
  parseEventOrThrow,
  parseWebhook,
  parseWebhookOrThrow,
  safeCompare,
  verifyHottok,
} from "../src/index.js";
import { fixtures } from "../src/fixtures/index.js";

const token = "test-hottok-123";
const body = JSON.stringify(fixtures.PURCHASE_APPROVED);

describe("safeCompare", () => {
  it("compares equal and different strings, including different lengths", () => {
    expect(safeCompare("abc", "abc")).toBe(true);
    expect(safeCompare("abc", "abd")).toBe(false);
    expect(safeCompare("abc", "abcd")).toBe(false);
    expect(safeCompare("", "x")).toBe(false);
  });
});

describe("verifyHottok", () => {
  it("accepts the correct header from a plain record (any casing)", () => {
    expect(verifyHottok({ "X-HOTMART-HOTTOK": token }, { token })).toBe(true);
    expect(verifyHottok({ "x-hotmart-hottok": token }, { token })).toBe(true);
  });

  it("accepts Node-style array header values (first value wins)", () => {
    expect(verifyHottok({ "x-hotmart-hottok": [token, "other"] }, { token })).toBe(true);
  });

  it("accepts a Web Headers instance and a Request", () => {
    expect(verifyHottok(new Headers({ "X-Hotmart-Hottok": token }), { token })).toBe(true);
    const request = new Request("https://example.com/hook", { method: "POST", headers: { "x-hotmart-hottok": token } });
    expect(verifyHottok(request, { token })).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(verifyHottok({ "x-hotmart-hottok": "nope" }, { token })).toBe(false);
    expect(checkHottok({ "x-hotmart-hottok": "nope" }, { token })).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a missing or empty header", () => {
    expect(checkHottok({}, { token })).toEqual({ valid: false, reason: "missing" });
    expect(checkHottok({ "x-hotmart-hottok": "" }, { token })).toEqual({ valid: false, reason: "missing" });
    expect(checkHottok(new Headers(), { token })).toEqual({ valid: false, reason: "missing" });
  });

  it("ignores the legacy query token unless allowed", () => {
    const request = new Request(`https://example.com/hook?hottok=${token}`, { method: "POST" });
    expect(checkHottok(request, { token })).toEqual({ valid: false, reason: "missing" });
    expect(checkHottok(request, { token, allowQueryToken: true })).toEqual({ valid: true, source: "query" });
  });

  it("reads the legacy query from { headers, query } in every supported shape", () => {
    const opts = { token, allowQueryToken: true };
    expect(verifyHottok({ headers: {}, query: { hottok: token } }, opts)).toBe(true);
    expect(verifyHottok({ headers: {}, query: { hottok: [token] } }, opts)).toBe(true);
    expect(verifyHottok({ headers: {}, query: `?hottok=${token}` }, opts)).toBe(true);
    expect(verifyHottok({ headers: {}, query: `hottok=${token}` }, opts)).toBe(true);
    expect(verifyHottok({ headers: {}, query: new URLSearchParams({ hottok: token }) }, opts)).toBe(true);
    expect(checkHottok({ headers: {}, query: { hottok: "bad" } }, opts)).toEqual({ valid: false, reason: "mismatch" });
    expect(checkHottok({ headers: {}, url: "/hook" }, opts)).toEqual({ valid: false, reason: "missing" });
    expect(checkHottok({ headers: {} }, opts)).toEqual({ valid: false, reason: "missing" });
  });

  it("prefers the header over the query", () => {
    const result = checkHottok(
      { headers: { "x-hotmart-hottok": token }, query: { hottok: "wrong" } },
      { token, allowQueryToken: true },
    );
    expect(result).toEqual({ valid: true, source: "header" });
  });

  it("throws a TypeError when the configured token is empty", () => {
    expect(() => verifyHottok({}, { token: "" })).toThrow(TypeError);
    // @ts-expect-error -- runtime guard for JS callers
    expect(() => verifyHottok({}, {})).toThrow(TypeError);
  });
});

describe("parseWebhook", () => {
  const headers = { "x-hotmart-hottok": token };

  it("returns a typed event for a valid request", () => {
    const result = parseWebhook(body, { token, headers });
    expect(result.ok).toBe(true);
    if (result.ok && result.event.event === "PURCHASE_APPROVED") {
      expect(result.event.data.purchase.transaction).toBe("HP0000000001");
    }
  });

  it("accepts Uint8Array and ArrayBuffer bodies", () => {
    const bytes = new TextEncoder().encode(body);
    expect(parseWebhook(bytes, { token, headers }).ok).toBe(true);
    expect(parseWebhook(bytes.buffer, { token, headers }).ok).toBe(true);
  });

  it("checks the token before decoding the body", () => {
    const result = parseWebhook("not json", { token, headers: {} });
    expect(result).toEqual({ ok: false, error: { code: "invalid_token", message: "Missing X-HOTMART-HOTTOK header." } });
    const wrong = parseWebhook(body, { token, headers: { "x-hotmart-hottok": "x" } });
    expect(!wrong.ok && wrong.error.message).toBe("Invalid hottok.");
  });

  it("supports the legacy query token when enabled", () => {
    expect(parseWebhook(body, { token, headers: {}, query: { hottok: token }, allowQueryToken: true }).ok).toBe(true);
    expect(parseWebhook(body, { token, headers: {}, query: { hottok: token } }).ok).toBe(false);
  });

  it("reports invalid JSON", () => {
    const result = parseWebhook("{oops", { token, headers });
    expect(!result.ok && result.error.code).toBe("invalid_json");
  });

  it("reports unsupported events with the event name and payload", () => {
    const payload = { id: "1", creation_date: 1, version: "2.0.0", event: "SOMETHING_NEW", data: {} };
    const result = parseWebhook(JSON.stringify(payload), { token, headers });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported_event");
      expect(result.error.event).toBe("SOMETHING_NEW");
      expect(result.error.payload).toEqual(payload);
    }
  });

  it("reports invalid payloads with issues", () => {
    const payload = JSON.parse(body);
    delete payload.data.purchase.transaction;
    const result = parseWebhook(JSON.stringify(payload), { token, headers });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_payload");
      expect(result.error.event).toBe("PURCHASE_APPROVED");
      expect(result.error.issues?.[0]?.path).toEqual(["data", "purchase", "transaction"]);
    }
  });
});

describe("parseEvent", () => {
  it.each([null, [], "string", 42])("rejects non-object payload %j", (payload) => {
    const result = parseEvent(payload);
    expect(!result.ok && result.error.code).toBe("invalid_payload");
  });

  it.each([{}, { event: "" }, { event: 1 }])("rejects payloads without an event name: %j", (payload) => {
    const result = parseEvent(payload);
    expect(!result.ok && result.error.issues?.[0]?.path).toEqual(["event"]);
  });
});

describe("throwing variants", () => {
  it("parseWebhookOrThrow returns the event or throws HotmartWebhookError", () => {
    expect(parseWebhookOrThrow(body, { token, headers: { "x-hotmart-hottok": token } }).event).toBe(
      "PURCHASE_APPROVED",
    );
    try {
      parseWebhookOrThrow(body, { token, headers: {} });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HotmartWebhookError);
      expect((error as HotmartWebhookError).code).toBe("invalid_token");
      expect((error as HotmartWebhookError).name).toBe("HotmartWebhookError");
    }
  });

  it("parseEventOrThrow carries issues and event name", () => {
    expect(parseEventOrThrow(JSON.parse(body)).id).toBe(fixtures.PURCHASE_APPROVED.id);
    const bad = JSON.parse(body);
    bad.data.product = null;
    try {
      parseEventOrThrow(bad);
      expect.unreachable();
    } catch (error) {
      const e = error as HotmartWebhookError;
      expect(e.code).toBe("invalid_payload");
      expect(e.event).toBe("PURCHASE_APPROVED");
      expect(e.issues?.length).toBeGreaterThan(0);
    }
  });
});
