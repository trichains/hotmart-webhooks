/**
 * Minimal structural types so the library works with Web `Headers`, Node's
 * `IncomingHttpHeaders` and plain objects without depending on any framework.
 */

/** Anything with a case-insensitive `get(name)`, e.g. the Web `Headers` class. */
export interface HeadersGetter {
  get(name: string): string | null;
}

/** Node-style header record (`IncomingHttpHeaders`) or any plain object. */
export type HeaderRecord = Record<string, string | string[] | undefined>;

export type HeadersInput = HeadersGetter | HeaderRecord;

/** Query string as a `URLSearchParams`, a plain record, or a raw string ("a=1&b=2"). */
export type QueryInput = URLSearchParams | Record<string, string | string[] | undefined> | string;

function isGetter(headers: HeadersInput): headers is HeadersGetter {
  return typeof (headers as HeadersGetter).get === "function";
}

/** Case-insensitive header lookup. Multi-value headers return the first value. */
export function getHeader(headers: HeadersInput | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (isGetter(headers)) return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function getQueryParam(query: QueryInput | undefined, name: string): string | undefined {
  if (query === undefined) return undefined;
  if (typeof query === "string") {
    return new URLSearchParams(query.startsWith("?") ? query.slice(1) : query).get(name) ?? undefined;
  }
  if (query instanceof URLSearchParams) return query.get(name) ?? undefined;
  const value = query[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Extract the query string from a request URL (absolute or path-only). */
export function queryFromUrl(url: string | undefined): URLSearchParams | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, "http://localhost").searchParams;
  } catch {
    /* v8 ignore next 2 -- URL with a base only throws on pathological input */
    return undefined;
  }
}

export function bodyToString(rawBody: string | Uint8Array | ArrayBuffer): string {
  if (typeof rawBody === "string") return rawBody;
  return new TextDecoder("utf-8").decode(rawBody);
}
