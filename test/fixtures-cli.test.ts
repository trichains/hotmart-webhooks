import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { coerceValue, parseCliArgs, parseOverride } from "../src/cli/args.js";
import { runCli, type CliIo } from "../src/cli/run.js";
import { WEBHOOK_EVENT_NAMES } from "../src/index.js";
import { createFixture, createFixtureRequest, deepMerge, fixtures, setPath } from "../src/fixtures/index.js";

describe("fixtures helpers", () => {
  it("createFixture returns a deep copy with overrides applied", () => {
    const a = createFixture("PURCHASE_APPROVED", { data: { purchase: { price: { value: 197 } } } });
    expect(a.data.purchase.price).toEqual({ value: 197, currency_value: "BRL" });
    expect(fixtures.PURCHASE_APPROVED.data.purchase.price!.value).toBe(97.9);
    a.data.product.name = "changed";
    expect(fixtures.PURCHASE_APPROVED.data.product.name).not.toBe("changed");
  });

  it("arrays in overrides replace the fixture arrays", () => {
    const e = createFixture("PURCHASE_APPROVED", { data: { affiliates: [] } });
    expect(e.data.affiliates).toEqual([]);
  });

  it("throws for an unknown event", () => {
    // @ts-expect-error -- runtime guard
    expect(() => createFixture("NOPE")).toThrow(/No fixture/);
  });

  it("deepMerge ignores undefined and prototype keys", () => {
    const merged = deepMerge({ a: 1, b: { c: 2 } }, JSON.parse('{"__proto__":{"polluted":true},"b":{"d":3},"e":null}'));
    expect(merged).toEqual({ a: 1, b: { c: 2, d: 3 }, e: null });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, 5)).toBe(5);
    expect(deepMerge(Object.create(null) as object, { x: 1 })).toEqual({ x: 1 });
  });

  it("setPath creates objects and arrays", () => {
    const target: Record<string, unknown> = {};
    setPath(target, "a.b.c", 1);
    setPath(target, "list.0.name", "x");
    expect(target).toEqual({ a: { b: { c: 1 } }, list: [{ name: "x" }] });
    expect(() => setPath(target, "a..b", 1)).toThrow(/Invalid path/);
    expect(() => setPath(target, "__proto__.x", 1)).toThrow(/Refusing/);
  });

  it("createFixtureRequest builds a POST with the hottok header", async () => {
    const req = createFixtureRequest("SWITCH_PLAN", { token: "t", url: "http://x.test/h", overrides: { id: "custom" } });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://x.test/h");
    expect(req.headers.get("x-hotmart-hottok")).toBe("t");
    expect(((await req.json()) as { id: string }).id).toBe("custom");
    expect(createFixtureRequest("SWITCH_PLAN", { token: "t" }).url).toBe("http://localhost/api/hotmart");
  });
});

describe("CLI argument parsing", () => {
  it("parses send with repeated overrides", () => {
    const cmd = parseCliArgs([
      "send",
      "--event",
      "PURCHASE_APPROVED",
      "--url",
      "http://localhost:3104/hook",
      "--token",
      "abc",
      "--override",
      "data.purchase.price.value=97",
      "-o",
      'data.purchase.offer.code="007"',
      "--id",
      "evt-1",
      "--timeout",
      "500",
      "--legacy-query",
    ]);
    expect(cmd).toEqual({
      command: "send",
      event: "PURCHASE_APPROVED",
      url: "http://localhost:3104/hook",
      token: "abc",
      overrides: [
        { path: "data.purchase.price.value", value: 97 },
        { path: "data.purchase.offer.code", value: "007" },
      ],
      id: "evt-1",
      dryRun: false,
      legacyQuery: true,
      timeoutMs: 500,
    });
  });

  it("parses the other commands", () => {
    expect(parseCliArgs([])).toEqual({ command: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ command: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ command: "version" });
    expect(parseCliArgs(["list-events"])).toEqual({ command: "list-events", json: false });
    expect(parseCliArgs(["list-events", "--json"])).toEqual({ command: "list-events", json: true });
    expect(parseCliArgs(["send", "-e", "SWITCH_PLAN", "--dry-run"])).toMatchObject({ dryRun: true, url: "" });
  });

  it.each([
    [["send"], /--event is required/],
    [["send", "-e", "NOPE", "-u", "http://x"], /unknown event/],
    [["send", "-e", "SWITCH_PLAN"], /--url is required/],
    [["send", "-e", "SWITCH_PLAN", "-u", "not a url"], /invalid --url/],
    [["send", "-e", "SWITCH_PLAN", "-u", "http://x", "--timeout", "-1"], /--timeout/],
    [["send", "--bogus"], /Unknown option/],
    [["send", "-e", "SWITCH_PLAN", "-u", "http://x", "-o", "novalue"], /path=value/],
    [["deploy"], /Unknown command/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  it("coerces override values", () => {
    expect(coerceValue("97.5")).toBe(97.5);
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("null")).toBeNull();
    expect(coerceValue('"97"')).toBe("97");
    expect(coerceValue('{"a":1}')).toEqual({ a: 1 });
    expect(coerceValue("hello world")).toBe("hello world");
    expect(parseOverride("a.b=x=y")).toEqual({ path: "a.b", value: "x=y" });
  });
});

function makeIo(overrides: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    fetch: vi.fn(),
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    env: {},
    version: "9.9.9",
    newId: () => "fixed-id",
    now: () => 1000,
    ...overrides,
  };
  return { io, out: () => out.join(""), err: () => err.join("") };
}

describe("runCli", () => {
  it("prints help, version and the event list", async () => {
    const help = makeIo();
    expect(await runCli(["help"], help.io)).toBe(0);
    expect(help.out()).toContain("hotmart-webhooks send");

    const version = makeIo();
    expect(await runCli(["--version"], version.io)).toBe(0);
    expect(version.out()).toBe("9.9.9\n");

    const list = makeIo();
    expect(await runCli(["list-events"], list.io)).toBe(0);
    for (const name of WEBHOOK_EVENT_NAMES) expect(list.out()).toContain(name);

    const json = makeIo();
    await runCli(["list-events", "--json"], json.io);
    expect(JSON.parse(json.out())).toHaveLength(WEBHOOK_EVENT_NAMES.length);
  });

  it("dry-run prints the payload with overrides and a fresh id", async () => {
    const { io, out } = makeIo();
    const code = await runCli(
      ["send", "-e", "PURCHASE_APPROVED", "--dry-run", "-o", "data.purchase.price.value=197"],
      io,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(out());
    expect(payload.id).toBe("fixed-id");
    expect(payload.data.purchase.price.value).toBe(197);
    expect(io.fetch).not.toHaveBeenCalled();
  });

  it("warns when overrides break the schema but still sends", async () => {
    const { io, err } = makeIo();
    await runCli(["send", "-e", "PURCHASE_APPROVED", "--dry-run", "-o", "data.purchase.transaction=123"], io);
    expect(err()).toContain("warning: payload no longer matches");
  });

  it("rejects overrides on forbidden paths", async () => {
    const { io, err } = makeIo();
    expect(await runCli(["send", "-e", "SWITCH_PLAN", "--dry-run", "-o", "__proto__.x=1"], io)).toBe(2);
    expect(err()).toContain("--override __proto__.x");
  });

  it("requires a token from --token or HOTMART_HOTTOK", async () => {
    const { io, err } = makeIo();
    expect(await runCli(["send", "-e", "SWITCH_PLAN", "-u", "http://localhost/h"], io)).toBe(2);
    expect(err()).toContain("HOTMART_HOTTOK");
  });

  it("posts the fixture with the hottok header (env token)", async () => {
    const fetch = vi.fn(async () => new Response('{"ok":true}', { status: 200, statusText: "OK" }));
    const { io, out } = makeIo({ fetch, env: { HOTMART_HOTTOK: "env-token" } });
    const code = await runCli(["send", "-e", "PURCHASE_APPROVED", "-u", "http://localhost:3104/api/hotmart"], io);
    expect(code).toBe(0);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3104/api/hotmart");
    expect((init.headers as Record<string, string>)["x-hotmart-hottok"]).toBe("env-token");
    expect(JSON.parse(init.body as string).event).toBe("PURCHASE_APPROVED");
    expect(out()).toContain("<- 200 OK");
    expect(out()).toContain("tx    HP0000000001");
  });

  it("sends the token in the query with --legacy-query and exits 1 on non-2xx", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 401, statusText: "Unauthorized" }));
    const { io } = makeIo({ fetch });
    const code = await runCli(["send", "-e", "CLUB_FIRST_ACCESS", "-u", "http://localhost/h", "-t", "x", "--legacy-query"], io);
    expect(code).toBe(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost/h?hottok=x");
    expect((init.headers as Record<string, string>)["x-hotmart-hottok"]).toBeUndefined();
  });

  it("reports network errors", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const { io, err } = makeIo({ fetch });
    expect(await runCli(["send", "-e", "SWITCH_PLAN", "-u", "http://localhost/h", "-t", "x"], io)).toBe(1);
    expect(err()).toContain("ECONNREFUSED");
  });

  it("includes the underlying cause of fetch failures", async () => {
    const withCode = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    });
    const a = makeIo({ fetch: withCode });
    await runCli(["send", "-e", "SWITCH_PLAN", "-u", "http://localhost/h", "-t", "x"], a.io);
    expect(a.err()).toBe("request failed: fetch failed (ECONNREFUSED)\n");

    const withMessage = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
    });
    const b = makeIo({ fetch: withMessage });
    await runCli(["send", "-e", "SWITCH_PLAN", "-u", "http://localhost/h", "-t", "x"], b.io);
    expect(b.err()).toContain("(getaddrinfo ENOTFOUND)");
  });

  it("rethrows unexpected errors", async () => {
    const { io } = makeIo({
      stdout: () => {
        throw new Error("stdout closed");
      },
    });
    await expect(runCli(["help"], io)).rejects.toThrow("stdout closed");
  });

  it("uses randomUUID and Date.now by default and talks to a real server", async () => {
    const received: { headers: IncomingMessage["headers"]; body: string }[] = [];
    const server = createServer(async (req, res) => {
      let data = "";
      for await (const chunk of req) data += chunk;
      received.push({ headers: req.headers, body: data });
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    try {
      const { io } = makeIo({ fetch: (url, init) => fetch(url, init), newId: undefined, now: undefined });
      const code = await runCli(["send", "-e", "PURCHASE_REFUNDED", "-u", `http://127.0.0.1:${port}/h`, "-t", "tok"], io);
      expect(code).toBe(0);
      expect(received[0]!.headers["x-hotmart-hottok"]).toBe("tok");
      expect(received[0]!.headers["user-agent"]).toBe("hotmart-webhooks-cli/9.9.9");
      expect(JSON.parse(received[0]!.body).id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      server.close();
    }
  });
});
