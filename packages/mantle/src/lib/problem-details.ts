import { MantleError } from "./errors.js";

/**
 * Error body format for the HTTP transports' `errors` option. `"problem+json"` (default) is RFC 9457 Problem Details,
 * served as `application/problem+json`; `"mantle"` is `MantleError.toJSON()` as `application/json`.
 */
export type ErrorFormat = "mantle" | "problem+json";

/** Base of the `type` URI for Mantle's built-in error classes — each resolves to a docs page. */
export const PROBLEM_TYPE_BASE = "https://mantlejs.com/errors/";

/** `className`s of the built-in `MantleError` subclasses, the ones with a page under `PROBLEM_TYPE_BASE`. */
const DOCUMENTED_CLASS_NAMES = new Set([
  "bad-request",
  "not-authenticated",
  "forbidden",
  "not-found",
  "method-not-allowed",
  "conflict",
  "precondition-failed",
  "unprocessable",
  "too-many-requests",
  "general-error",
  "not-implemented",
  "unavailable",
]);

/** RFC 9457 Problem Details, with Mantle's extension members. */
export interface ProblemDetails {
  /**
   * `https://mantlejs.com/errors/<className>` for built-in error classes. An app-defined class has no page there,
   * so it gets `about:blank`, whose meaning is just the HTTP status (RFC 9457 §4.2.1).
   */
  type: string;
  /** The error class name in words, e.g. `"Too Many Requests"` — the same for every occurrence of that class. */
  title: string;
  status: number;
  /** The error's message. Omitted for unexpected (non-`MantleError`) errors, so internals never leak. */
  detail?: string;
  /** The request path the problem occurred on. */
  instance?: string;
  className?: string;
  data?: unknown;
  errors?: unknown[];
  hint?: string;
  requestId?: string;
}

export interface ErrorResponseContext {
  /** Request path (no query string — it may carry tokens), used as `instance`. */
  instance?: string;
  requestId?: string;
}

/** `"TooManyRequests"` → `"Too Many Requests"`. */
function words(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/**
 * Map any thrown value to Problem Details. A `MantleError` keeps its message, `data`, `errors`, and `hint`; anything
 * else becomes a bare 500 with no detail.
 */
export function toProblemDetails(err: unknown, context: ErrorResponseContext = {}): ProblemDetails {
  const location = {
    ...(context.instance !== undefined ? { instance: context.instance } : {}),
    ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
  };
  if (!(err instanceof MantleError)) {
    return { type: `${PROBLEM_TYPE_BASE}general-error`, title: "General Error", status: 500, ...location };
  }
  const documented = DOCUMENTED_CLASS_NAMES.has(err.className);
  return {
    type: documented ? `${PROBLEM_TYPE_BASE}${err.className}` : "about:blank",
    title: words(err.name),
    status: err.code,
    detail: err.message,
    ...location,
    className: err.className,
    ...(err.data !== undefined ? { data: err.data } : {}),
    ...(err.errors !== undefined ? { errors: err.errors } : {}),
    ...(err.hint !== undefined ? { hint: err.hint } : {}),
  };
}

/**
 * The status, `Content-Type`, and body an HTTP transport sends for a thrown error. Shared by express, koa, and http
 * so both formats are byte-for-byte identical across transports.
 */
export function errorResponse(
  err: unknown,
  format: ErrorFormat = "problem+json",
  context: ErrorResponseContext = {},
): { status: number; contentType: string; body: Record<string, unknown> } {
  if (format === "problem+json") {
    const problem = toProblemDetails(err, context);
    return { status: problem.status, contentType: "application/problem+json", body: { ...problem } };
  }
  if (err instanceof MantleError) {
    return { status: err.code, contentType: "application/json", body: err.toJSON() };
  }
  return {
    status: 500,
    contentType: "application/json",
    body: {
      name: "GeneralError",
      // Never the thrown value's own message: it may carry internals (SQL, file paths, credentials).
      message: "An unexpected error occurred",
      code: 500,
      className: "general-error",
    },
  };
}
