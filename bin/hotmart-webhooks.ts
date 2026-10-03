import { runCli } from "../src/cli/run.js";

declare const __PKG_VERSION__: string;

const version = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0-dev";

runCli(process.argv.slice(2), {
  fetch: (url, init) => fetch(url, init),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  version,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  },
);
