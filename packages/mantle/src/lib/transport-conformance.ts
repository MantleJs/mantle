import { getContext } from "./context.js";
import { BadRequest, MantleError, TooManyRequests } from "./errors.js";
import type { ErrorFormat } from "./problem-details.js";
import type { TrustProxy } from "./transport.js";
import type { HookContext, MantleApplication } from "./types.js";

/**
 * Shared conformance fixture for the HTTP transports (express, koa, http), in the same spirit as
 * `NESTED_QUERY_CASES`: every transport's spec registers these services, sends each case's request,
 * and asserts the expectations — so `context.http`, `params.ip`, and request-ID behavior can't drift
 * between transports.
 */
export interface TransportConformanceCase {
  name: string;
  /** Passed to the transport under test as its `trustProxy` option. */
  trustProxy?: TrustProxy;
  /** Passed to the transport under test as its `errors` option. */
  errors?: ErrorFormat;
  request: { method: "GET" | "POST" | "DELETE"; path: string; headers?: Record<string, string>; body?: unknown };
  expect: {
    status: number;
    /** Exact header values (case-insensitive names); `null` asserts the header is absent. */
    headers?: Record<string, string | null>;
    /** Header values that must match a pattern. */
    headerPatterns?: Record<string, RegExp>;
    /** `"empty"` asserts no body; an object is matched as a subset of the parsed JSON body. */
    body?: "empty" | Record<string, unknown>;
    /** Asserts the response's `X-Request-Id` equals this field of the parsed JSON body. */
    requestIdEqualsBodyField?: string;
    /** The `Content-Type` must start with this (parameters like `; charset=utf-8` are ignored). */
    contentType?: string;
    /** Text that must not appear anywhere in the raw body — e.g. an internal error message. */
    bodyExcludes?: string;
  };
}

/** An app-defined error class: no docs page on mantlejs.com, so Problem Details uses `about:blank`. */
class TeapotError extends MantleError {
  constructor(message = "I'm a teapot") {
    super(message, 418, "teapot");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fake peer and proxy addresses. Specs connect over `127.0.0.1`, so the socket peer is always `127.0.0.1`. */
const FORWARDED_FOR = "198.51.100.9, 203.0.113.7";

/**
 * Register the services the cases target. Call after `.configure(<transport>)`, since transports
 * mount routes when a service is registered.
 */
export function registerTransportConformanceServices(app: MantleApplication): void {
  app.use(
    "conformance-echo",
    {
      async get(_id, params) {
        return { ip: params?.ip, requestId: params?.requestId, contextRequestId: getContext()?.requestId };
      },
    },
    { methods: ["get"] },
  );

  app.use<Record<string, unknown>>(
    "conformance-status",
    {
      async get(id) {
        return { id };
      },
      async create(data) {
        return data;
      },
      async remove(id) {
        return { id };
      },
    },
    { methods: ["get", "create", "remove"] },
  );
  app.service("conformance-status").hooks({
    before: {
      get: [
        // What a conditional-request hook does on an If-None-Match hit: short-circuit with a 304.
        (context: HookContext) => {
          context.http = { status: 304, headers: { ETag: '"v1"' } };
          context.result = { id: context.id };
          return context;
        },
      ],
      create: [(context: HookContext) => ({ ...context, http: { status: 202 } })],
      remove: [(context: HookContext) => ({ ...context, http: { status: 204 } })],
    },
  });

  app.use(
    "conformance-headers",
    {
      async find() {
        return [];
      },
    },
    { methods: ["find"] },
  );
  app.service("conformance-headers").hooks({
    after: { find: [(context: HookContext) => ({ ...context, http: { headers: { "X-Conformance": "ok" } } })] },
  });

  app.use(
    "conformance-error",
    {
      async find() {
        return [];
      },
    },
    { methods: ["find"] },
  );
  app.service("conformance-error").hooks({
    before: {
      find: [
        // Returns a new context (not a mutation) to prove the error path still sees it.
        (context: HookContext) => ({
          ...context,
          http: { headers: { RateLimit: "limit=10, remaining=0, reset=30", "X-Override": "hook" } },
        }),
        () => {
          throw Object.assign(new TooManyRequests("Slow down"), {
            headers: { "Retry-After": "30", "X-Override": "error" },
          });
        },
      ],
    },
  });

  app.use(
    "conformance-fail",
    {
      async get(id) {
        if (id === "mantle") throw new BadRequest("Bad input", { field: "x" }, undefined, "Fix x");
        if (id === "teapot") throw new TeapotError();
        throw new Error("secret internal detail");
      },
    },
    { methods: ["get"] },
  );

  app.use(
    "conformance-internal",
    {
      async find() {
        return [];
      },
    },
    { methods: ["find"] },
  );
  app.service("conformance-internal").hooks({
    before: {
      find: [
        async (context: HookContext) => {
          // An internal call made from a hook: its context.http must not reach the outer response.
          await context.app.service("conformance-headers").find({});
          return context;
        },
      ],
    },
  });
}

export const TRANSPORT_CONFORMANCE_CASES: TransportConformanceCase[] = [
  {
    name: "context.http.status overrides the default success status",
    request: { method: "POST", path: "/conformance-status", body: { name: "a" } },
    expect: { status: 202, body: { name: "a" } },
  },
  {
    name: "a 304 sends headers and no body",
    request: { method: "GET", path: "/conformance-status/1" },
    expect: { status: 304, headers: { ETag: '"v1"' }, body: "empty" },
  },
  {
    name: "a 204 sends no body",
    request: { method: "DELETE", path: "/conformance-status/1" },
    expect: { status: 204, body: "empty" },
  },
  {
    name: "context.http.headers are sent on success",
    request: { method: "GET", path: "/conformance-headers" },
    expect: { status: 200, headers: { "X-Conformance": "ok" } },
  },
  {
    name: "headers set before an error survive it; MantleError.headers win on conflict; error body is unchanged",
    request: { method: "GET", path: "/conformance-error" },
    expect: {
      status: 429,
      headers: { RateLimit: "limit=10, remaining=0, reset=30", "Retry-After": "30", "X-Override": "error" },
      body: { name: "TooManyRequests", message: "Slow down", code: 429 },
    },
  },
  {
    name: "an internal call's context.http does not leak into the outer response",
    request: { method: "GET", path: "/conformance-internal" },
    expect: { status: 200, headers: { "X-Conformance": null } },
  },
  {
    name: "a missing X-Request-Id is generated, echoed, and bound into params and the request context",
    request: { method: "GET", path: "/conformance-echo/1" },
    expect: {
      status: 200,
      headerPatterns: { "X-Request-Id": UUID },
      headers: { "X-Correlation-Id": null },
      requestIdEqualsBodyField: "requestId",
    },
  },
  {
    name: "a valid X-Request-Id is echoed and bound into the request context",
    request: { method: "GET", path: "/conformance-echo/1", headers: { "X-Request-Id": "req-abc_123" } },
    expect: { status: 200, headers: { "X-Request-Id": "req-abc_123" }, body: { contextRequestId: "req-abc_123" } },
  },
  {
    name: "an invalid X-Request-Id is replaced with a generated one",
    request: { method: "GET", path: "/conformance-echo/1", headers: { "X-Request-Id": "bad id with spaces" } },
    expect: { status: 200, headerPatterns: { "X-Request-Id": UUID }, requestIdEqualsBodyField: "requestId" },
  },
  {
    name: "an over-long X-Request-Id is replaced with a generated one",
    request: { method: "GET", path: "/conformance-echo/1", headers: { "X-Request-Id": "a".repeat(129) } },
    expect: { status: 200, headerPatterns: { "X-Request-Id": UUID } },
  },
  {
    name: "a legacy X-Correlation-Id is accepted and echoed under both names",
    request: { method: "GET", path: "/conformance-echo/1", headers: { "X-Correlation-Id": "legacy-1" } },
    expect: {
      status: 200,
      headers: { "X-Request-Id": "legacy-1", "X-Correlation-Id": "legacy-1" },
      body: { requestId: "legacy-1" },
    },
  },
  {
    name: "X-Request-Id wins over X-Correlation-Id",
    request: {
      method: "GET",
      path: "/conformance-echo/1",
      headers: { "X-Request-Id": "new-1", "X-Correlation-Id": "legacy-1" },
    },
    expect: { status: 200, headers: { "X-Request-Id": "new-1", "X-Correlation-Id": null } },
  },
  {
    name: "the request ID is echoed on error responses",
    request: { method: "GET", path: "/conformance-error", headers: { "X-Request-Id": "err-1" } },
    expect: { status: 429, headers: { "X-Request-Id": "err-1" } },
  },
  {
    name: "errors default to Mantle's JSON shape",
    request: { method: "GET", path: "/conformance-fail/mantle" },
    expect: {
      status: 400,
      contentType: "application/json",
      body: { name: "BadRequest", message: "Bad input", code: 400, className: "bad-request", hint: "Fix x" },
    },
  },
  {
    name: 'errors: "problem+json" maps a MantleError to RFC 9457 Problem Details',
    errors: "problem+json",
    request: { method: "GET", path: "/conformance-fail/mantle?token=abc", headers: { "X-Request-Id": "prob-1" } },
    expect: {
      status: 400,
      contentType: "application/problem+json",
      body: {
        type: "https://mantlejs.com/errors/bad-request",
        title: "Bad Request",
        status: 400,
        detail: "Bad input",
        instance: "/conformance-fail/mantle",
        className: "bad-request",
        data: { field: "x" },
        hint: "Fix x",
        requestId: "prob-1",
      },
      bodyExcludes: "token",
    },
  },
  {
    name: 'errors: "problem+json" maps an unexpected error to a bare 500 that leaks nothing',
    errors: "problem+json",
    request: { method: "GET", path: "/conformance-fail/crash" },
    expect: {
      status: 500,
      contentType: "application/problem+json",
      body: { type: "https://mantlejs.com/errors/general-error", title: "General Error", status: 500 },
      requestIdEqualsBodyField: "requestId",
      bodyExcludes: "secret",
    },
  },
  {
    name: 'errors: "problem+json" uses about:blank for an app-defined error class',
    errors: "problem+json",
    request: { method: "GET", path: "/conformance-fail/teapot" },
    expect: {
      status: 418,
      contentType: "application/problem+json",
      body: { type: "about:blank", title: "Teapot Error", status: 418, detail: "I'm a teapot", className: "teapot" },
    },
  },
  {
    name: 'errors: "problem+json" keeps hook and error headers on the error response',
    errors: "problem+json",
    request: { method: "GET", path: "/conformance-error" },
    expect: {
      status: 429,
      contentType: "application/problem+json",
      headers: { RateLimit: "limit=10, remaining=0, reset=30", "Retry-After": "30" },
      body: { type: "https://mantlejs.com/errors/too-many-requests", title: "Too Many Requests", status: 429 },
    },
  },
  {
    name: 'errors: "problem+json" leaves success responses as plain JSON',
    errors: "problem+json",
    request: { method: "GET", path: "/conformance-headers" },
    expect: { status: 200, contentType: "application/json" },
  },
  {
    name: "params.ip is the socket peer, ignoring X-Forwarded-For, without trustProxy",
    request: { method: "GET", path: "/conformance-echo/1", headers: { "X-Forwarded-For": FORWARDED_FOR } },
    expect: { status: 200, body: { ip: "127.0.0.1" } },
  },
  {
    name: "params.ip is the leftmost X-Forwarded-For entry with trustProxy: true",
    trustProxy: true,
    request: { method: "GET", path: "/conformance-echo/1", headers: { "X-Forwarded-For": FORWARDED_FOR } },
    expect: { status: 200, body: { ip: "198.51.100.9" } },
  },
  {
    name: "params.ip is the address one hop behind the peer with trustProxy: 1",
    trustProxy: 1,
    request: { method: "GET", path: "/conformance-echo/1", headers: { "X-Forwarded-For": FORWARDED_FOR } },
    expect: { status: 200, body: { ip: "203.0.113.7" } },
  },
  {
    name: "params.ip falls back to the peer with trustProxy when X-Forwarded-For is absent",
    trustProxy: true,
    request: { method: "GET", path: "/conformance-echo/1" },
    expect: { status: 200, body: { ip: "127.0.0.1" } },
  },
];

/** What a transport spec captured from one response, for `checkTransportConformance()`. */
export interface TransportConformanceResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: string;
}

/**
 * Check a response against a case's expectations. Returns one message per failed expectation (empty
 * when the case passes), so specs assert `expect(failures).toEqual([])` and every transport shares
 * the same checks without core depending on a test runner.
 */
export function checkTransportConformance(
  testCase: TransportConformanceCase,
  response: TransportConformanceResponse,
): string[] {
  const failures: string[] = [];
  const { expect } = testCase;
  if (response.status !== expect.status) failures.push(`status: expected ${expect.status}, got ${response.status}`);

  for (const [name, value] of Object.entries(expect.headers ?? {})) {
    const actual = response.headers.get(name);
    if (actual !== value)
      failures.push(`header ${name}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
  }
  for (const [name, pattern] of Object.entries(expect.headerPatterns ?? {})) {
    const actual = response.headers.get(name);
    if (actual === null || !pattern.test(actual))
      failures.push(`header ${name}: ${JSON.stringify(actual)} does not match ${pattern}`);
  }

  if (expect.contentType !== undefined) {
    const contentType = response.headers.get("Content-Type");
    if (contentType === null || !contentType.startsWith(expect.contentType)) {
      failures.push(`Content-Type: expected ${expect.contentType}, got ${JSON.stringify(contentType)}`);
    }
  }
  if (expect.bodyExcludes !== undefined && response.body.includes(expect.bodyExcludes)) {
    failures.push(`body must not contain ${JSON.stringify(expect.bodyExcludes)}: ${response.body}`);
  }

  if (expect.body === "empty") {
    if (response.body !== "") failures.push(`body: expected empty, got ${JSON.stringify(response.body)}`);
    return failures;
  }
  if (expect.body === undefined && expect.requestIdEqualsBodyField === undefined) return failures;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    failures.push(`body: expected JSON, got ${JSON.stringify(response.body)}`);
    return failures;
  }
  for (const [key, value] of Object.entries(expect.body ?? {})) {
    if (JSON.stringify(parsed[key]) !== JSON.stringify(value)) {
      failures.push(`body.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(parsed[key])}`);
    }
  }
  if (expect.requestIdEqualsBodyField !== undefined) {
    const field = expect.requestIdEqualsBodyField;
    const header = response.headers.get("X-Request-Id");
    if (header === null || parsed[field] !== header) {
      failures.push(
        `X-Request-Id ${JSON.stringify(header)} does not equal body.${field} ${JSON.stringify(parsed[field])}`,
      );
    }
  }
  return failures;
}
