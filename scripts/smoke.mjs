// Smoke test for the built package: loads the ESM and CJS builds and runs one
// full request through each. Used by CI on Node 18, where Vitest cannot run.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const token = "smoke-token";

async function check(label, core, fixturesMod, nextAdapter) {
  const seen = [];
  const handler = core.createWebhookHandler({ token, handlers: { "*": (e) => seen.push(e.event) } });
  for (const name of core.WEBHOOK_EVENT_NAMES) {
    const result = core.parseEvent(JSON.parse(JSON.stringify(fixturesMod.fixtures[name])));
    assert.equal(result.ok, true, `${label}: fixture ${name} should parse`);
  }
  const POST = nextAdapter.toNextRouteHandler(handler);
  const ok = await POST(fixturesMod.createFixtureRequest("PURCHASE_APPROVED", { token }));
  assert.equal(ok.status, 200, `${label}: valid request`);
  const bad = await POST(fixturesMod.createFixtureRequest("PURCHASE_APPROVED", { token: "nope" }));
  assert.equal(bad.status, 401, `${label}: bad token`);
  assert.deepEqual(seen, ["PURCHASE_APPROVED"]);
  assert.equal(core.toMinorUnits(97.9, "BRL"), 9790);
  console.log(`${label}: ok`);
}

await check(
  "esm",
  await import("../dist/index.js"),
  await import("../dist/fixtures/index.js"),
  await import("../dist/adapters/next.js"),
);
await check(
  "cjs",
  require("../dist/index.cjs"),
  require("../dist/fixtures/index.cjs"),
  require("../dist/adapters/next.cjs"),
);
console.log(`smoke passed on Node ${process.version}`);
