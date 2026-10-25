/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) parsing, shared by the HTTP transports so
 * every one accepts and drops the same headers. Malformed values are dropped rather than rejected: a
 * bad `traceparent` must never fail the request, it just starts a new trace.
 */

/** The fields of a valid `traceparent` header. */
export interface Traceparent {
  /** Two lower-case hex digits; `00` is the only version defined so far. */
  version: string;
  /** 32 lower-case hex digits, not all zero. */
  traceId: string;
  /** The caller's span ID (the spec's `parent-id`): 16 lower-case hex digits, not all zero. */
  spanId: string;
  /** Two lower-case hex digits of trace flags. */
  flags: string;
  /** Bit 0 of `flags`: the caller recorded this trace. */
  sampled: boolean;
}

/** The validated trace headers of a request, as `params.traceparent` / `params.tracestate` carry them. */
export interface TraceHeaders {
  traceparent?: string;
  tracestate?: string;
}

const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

// tracestate list-member grammar: a simple or multi-tenant (`tenant@system`) key, and a value of printable
// ASCII except `,` and `=` that doesn't end in a space.
const TRACESTATE_KEY = /^(?:[a-z0-9][_0-9a-z*/-]{0,255}|[a-z0-9][_0-9a-z*/-]{0,240}@[a-z][_0-9a-z*/-]{0,13})$/;
const TRACESTATE_VALUE = /^[\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}[\x21-\x2b\x2d-\x3c\x3e-\x7e]$/;
const TRACESTATE_MAX_MEMBERS = 32;

/**
 * Parse a `traceparent` header. Returns undefined for anything the spec says to ignore: a malformed
 * value, upper-case hex, version `ff`, an all-zero trace or span ID, or a version `00` header with
 * trailing data. Versions above `00` are read by their first four fields, as the spec requires.
 */
export function parseTraceparent(value: string | undefined): Traceparent | undefined {
  if (value === undefined) return undefined;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const [, version, traceId, spanId, flags, rest] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string?,
  ];
  if (version === "ff" || (version === "00" && rest !== undefined)) return undefined;
  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) return undefined;
  return { version, traceId, spanId, flags, sampled: (parseInt(flags, 16) & 1) === 1 };
}

/**
 * Validate a `tracestate` header (multiple headers may be joined with commas). Returns the list with
 * empty members and surrounding whitespace removed, or undefined when any member is malformed, a key
 * repeats, or there are more than 32 members — the spec lets a receiver discard the whole header then.
 */
export function parseTracestate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const members = value
    .split(",")
    .map((member) => member.trim())
    .filter((member) => member.length > 0);
  if (members.length === 0 || members.length > TRACESTATE_MAX_MEMBERS) return undefined;
  const keys = new Set<string>();
  for (const member of members) {
    const eq = member.indexOf("=");
    if (eq <= 0) return undefined;
    const key = member.slice(0, eq);
    if (!TRACESTATE_KEY.test(key) || !TRACESTATE_VALUE.test(member.slice(eq + 1)) || keys.has(key)) return undefined;
    keys.add(key);
  }
  return members.join(",");
}

/**
 * Resolve the trace headers of an incoming request. `getHeader` receives lower-case header names.
 * A valid `traceparent` is re-serialized as version `00`, the version this implementation speaks;
 * `tracestate` is kept only alongside a valid `traceparent`, since it has no meaning on its own.
 * More than one `traceparent` header is malformed and dropped.
 */
export function resolveTraceHeaders(getHeader: (name: string) => string | string[] | undefined): TraceHeaders {
  const raw = getHeader("traceparent");
  if (Array.isArray(raw) && raw.length > 1) return {};
  const parsed = parseTraceparent(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed) return {};
  const rawState = getHeader("tracestate");
  const tracestate = parseTracestate(Array.isArray(rawState) ? rawState.join(",") : rawState);
  const traceparent = `00-${parsed.traceId}-${parsed.spanId}-${parsed.flags}`;
  return tracestate === undefined ? { traceparent } : { traceparent, tracestate };
}
