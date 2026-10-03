import { randomUUID } from "node:crypto";
import { EVENT_INFO, WEBHOOK_EVENT_NAMES } from "../events.js";
import { createFixture, setPath } from "../fixtures/index.js";
import { parseEvent } from "../parse.js";
import { HOTTOK_HEADER, HOTTOK_QUERY_PARAM } from "../verify.js";
import { CliUsageError, HELP_TEXT, parseCliArgs, type CliCommand } from "./args.js";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CliIo {
  fetch: FetchLike;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  version: string;
  /** Override for deterministic ids in tests. */
  newId?: () => string;
  now?: () => number;
}

function listEvents(io: CliIo, json: boolean): number {
  if (json) {
    io.stdout(JSON.stringify(WEBHOOK_EVENT_NAMES.map((name) => ({ name, ...EVENT_INFO[name] })), null, 2) + "\n");
    return 0;
  }
  const width = Math.max(...WEBHOOK_EVENT_NAMES.map((n) => n.length));
  const lines = [`${"EVENT".padEnd(width)}  ${"CATEGORY".padEnd(12)}  PAID  DESCRIPTION`];
  for (const name of WEBHOOK_EVENT_NAMES) {
    const info = EVENT_INFO[name];
    lines.push(
      `${name.padEnd(width)}  ${info.category.padEnd(12)}  ${(info.paid ? "yes" : "no").padEnd(4)}  ${info.description}`,
    );
  }
  io.stdout(lines.join("\n") + "\n");
  return 0;
}

async function send(io: CliIo, cmd: Extract<CliCommand, { command: "send" }>): Promise<number> {
  const payload = createFixture(cmd.event) as Record<string, unknown>;
  payload.id = cmd.id ?? (io.newId ?? randomUUID)();
  for (const { path, value } of cmd.overrides) {
    try {
      setPath(payload, path, value);
    } catch (error) {
      throw new CliUsageError(`--override ${path}: ${(error as Error).message}`);
    }
  }

  const check = parseEvent(payload);
  if (!check.ok) {
    io.stderr(`warning: payload no longer matches the ${cmd.event} schema (${check.error.message}); sending anyway\n`);
  }

  const body = JSON.stringify(payload);
  if (cmd.dryRun) {
    io.stdout(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  }

  const token = cmd.token ?? io.env.HOTMART_HOTTOK;
  if (!token) throw new CliUsageError("send: pass --token or set HOTMART_HOTTOK");

  const url = new URL(cmd.url);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": `hotmart-webhooks-cli/${io.version}`,
  };
  if (cmd.legacyQuery) url.searchParams.set(HOTTOK_QUERY_PARAM, token);
  else headers[HOTTOK_HEADER] = token;

  const now = io.now ?? Date.now;
  const started = now();
  const data = payload.data as { purchase?: { transaction?: string } } | undefined;
  io.stdout(`-> POST ${cmd.url}\n   event ${cmd.event}\n   id    ${String(payload.id)}\n`);
  if (data?.purchase?.transaction) io.stdout(`   tx    ${data.purchase.transaction}\n`);

  let response: Response;
  try {
    response = await io.fetch(url.toString(), {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(cmd.timeoutMs),
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message;
    io.stderr(`request failed: ${(error as Error).message}${detail ? ` (${detail})` : ""}\n`);
    return 1;
  }

  const text = await response.text();
  io.stdout(`<- ${response.status} ${response.statusText} (${now() - started} ms)\n`);
  if (text) io.stdout(`${text}\n`);
  return response.ok ? 0 : 1;
}

/** Run the CLI. Returns the process exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const cmd = parseCliArgs(argv);
    switch (cmd.command) {
      case "help":
        io.stdout(HELP_TEXT);
        return 0;
      case "version":
        io.stdout(`${io.version}\n`);
        return 0;
      case "list-events":
        return listEvents(io, cmd.json);
      case "send":
        return await send(io, cmd);
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.stderr(`error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
