import { parseArgs } from "node:util";
import { isWebhookEventName, type WebhookEventName } from "../events.js";

export interface Override {
  path: string;
  value: unknown;
}

export type CliCommand =
  | {
      command: "send";
      event: WebhookEventName;
      url: string;
      token: string | undefined;
      overrides: Override[];
      id: string | undefined;
      dryRun: boolean;
      legacyQuery: boolean;
      timeoutMs: number;
    }
  | { command: "list-events"; json: boolean }
  | { command: "help" }
  | { command: "version" };

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * Turn an override value into JSON when it parses as JSON (numbers, booleans,
 * null, quoted strings, objects); otherwise keep the raw string.
 * `97` → 97, `true` → true, `"97"` → "97", `abc` → "abc".
 */
export function coerceValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseOverride(raw: string): Override {
  const eq = raw.indexOf("=");
  if (eq <= 0) throw new CliUsageError(`--override expects path=value, got "${raw}"`);
  return { path: raw.slice(0, eq).trim(), value: coerceValue(raw.slice(eq + 1)) };
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const [command, ...rest] = argv;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }
  if (command === "--version" || command === "-v" || command === "version") return { command: "version" };

  if (command === "list-events") {
    const { values } = parseArgs({ args: rest, options: { json: { type: "boolean", default: false } } });
    return { command: "list-events", json: values.json === true };
  }

  if (command === "send") {
    let values;
    try {
      ({ values } = parseArgs({
        args: rest,
        options: {
          event: { type: "string", short: "e" },
          url: { type: "string", short: "u" },
          token: { type: "string", short: "t" },
          override: { type: "string", short: "o", multiple: true },
          id: { type: "string" },
          "dry-run": { type: "boolean", default: false },
          "legacy-query": { type: "boolean", default: false },
          timeout: { type: "string" },
        },
      }));
    } catch (error) {
      throw new CliUsageError((error as Error).message);
    }

    const event = values.event;
    if (!event) throw new CliUsageError("send: --event is required (see `hotmart-webhooks list-events`)");
    if (!isWebhookEventName(event)) {
      throw new CliUsageError(`send: unknown event "${event}" (see \`hotmart-webhooks list-events\`)`);
    }
    const dryRun = values["dry-run"] === true;
    const url = values.url;
    if (!url && !dryRun) throw new CliUsageError("send: --url is required");
    if (url) {
      try {
        new URL(url);
      } catch {
        throw new CliUsageError(`send: invalid --url "${url}"`);
      }
    }
    const timeoutMs = values.timeout === undefined ? 10_000 : Number(values.timeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new CliUsageError("send: --timeout must be a positive integer (milliseconds)");
    }

    return {
      command: "send",
      event,
      url: url ?? "",
      token: values.token,
      overrides: (values.override ?? []).map(parseOverride),
      id: values.id,
      dryRun,
      legacyQuery: values["legacy-query"] === true,
      timeoutMs,
    };
  }

  throw new CliUsageError(`Unknown command "${command}". Run \`hotmart-webhooks help\`.`);
}

export const HELP_TEXT = `hotmart-webhooks - send fake Hotmart webhooks to a local endpoint

Usage
  hotmart-webhooks send --event <EVENT> --url <URL> [options]
  hotmart-webhooks list-events [--json]
  hotmart-webhooks help | --version

send options
  -e, --event <EVENT>        Event to send, e.g. PURCHASE_APPROVED
  -u, --url <URL>            Endpoint that receives the webhook
  -t, --token <HOTTOK>       Sent as X-HOTMART-HOTTOK. Defaults to $HOTMART_HOTTOK
                             (prefer the env var: arguments show up in shell history)
  -o, --override <path=val>  Change a field, repeatable: data.purchase.price.value=197
      --id <ID>              Event id to send. Default: a new UUID per run
      --legacy-query         Send the token as ?hottok= instead of the header
      --dry-run              Print the payload without sending it
      --timeout <ms>         Request timeout. Default: 10000

Examples
  HOTMART_HOTTOK=dev-token hotmart-webhooks send -e PURCHASE_APPROVED -u http://localhost:3000/api/hotmart
  hotmart-webhooks send -e PURCHASE_REFUNDED --dry-run -o data.purchase.transaction=HP1234567890
`;
