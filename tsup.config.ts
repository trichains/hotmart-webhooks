import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "fixtures/index": "src/fixtures/index.ts",
      "adapters/next": "src/adapters/next.ts",
      "adapters/node": "src/adapters/node.ts",
      "adapters/express": "src/adapters/express.ts",
    },
    format: ["esm", "cjs"],
    dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
    sourcemap: true,
    clean: true,
    target: "node18",
    platform: "node",
    treeshake: true,
  },
  {
    // The CLI is ESM only; it is an executable, not an importable entry.
    entry: { cli: "bin/hotmart-webhooks.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: false,
    target: "node18",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
    define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  },
]);
