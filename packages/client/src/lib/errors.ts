/** HTTP status → Mantle error-class name, used when the response body carries no `name`. */
const STATUS_NAMES: Record<number, string> = {
  400: "BadRequest",
  401: "NotAuthenticated",
  403: "Forbidden",
  404: "NotFound",
  405: "MethodNotAllowed",
  409: "Conflict",
  412: "PreconditionFailed",
  422: "Unprocessable",
  429: "TooManyRequests",
  500: "GeneralError",
  501: "NotImplemented",
  503: "Unavailable",
};

/** `"too-many-requests"` → `"TooManyRequests"` — the server's class name, from its `className`. */
function classNameToName(className: string): string {
  return className.replace(/(^|-)([a-z0-9])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());
}

export interface MantleClientErrorFields {
  className?: string;
  data?: unknown;
  errors?: unknown[];
  hint?: string;
  /** The request's `X-Request-Id` (or Problem Details' `requestId`) — quote it when reporting the error. */
  requestId?: string;
  /** Problem Details' `type` URI, when the server sent `application/problem+json`. */
  type?: string;
}

/**
 * Client-side counterpart of the server's `MantleError` JSON format.
 * `name` mirrors the server error class (`"NotFound"`, `"BadRequest"`, …),
 * `code` the HTTP status. `hint`, when present, is the server's actionable
 * guidance on how to make the request succeed.
 */
export class MantleClientError extends Error {
  readonly code: number;
  readonly className?: string;
  readonly data?: unknown;
  readonly errors?: unknown[];
  readonly hint?: string;
  readonly requestId?: string;
  readonly type?: string;

  constructor(message: string, code: number, name: string, fields: MantleClientErrorFields = {}) {
    super(message);
    this.name = name;
    this.code = code;
    this.className = fields.className;
    this.data = fields.data;
    this.errors = fields.errors;
    this.hint = fields.hint;
    this.requestId = fields.requestId;
    this.type = fields.type;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Deserialize a non-2xx `Response` into a `MantleClientError`. Reads either error shape the server's `errors` option
 * produces — Mantle's JSON or RFC 9457 Problem Details (`application/problem+json`) — and falls back to the HTTP
 * status alone when the body is neither (e.g. a gateway error page).
 */
export async function errorFromResponse(response: Response): Promise<MantleClientError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed !== null && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON body — construct from the status line alone.
  }
  const string = (key: string): string | undefined =>
    typeof body[key] === "string" ? (body[key] as string) : undefined;
  const className = string("className");
  const fields: MantleClientErrorFields = {
    className,
    data: body["data"],
    errors: Array.isArray(body["errors"]) ? body["errors"] : undefined,
    hint: string("hint"),
    requestId: string("requestId") ?? response.headers.get("x-request-id") ?? undefined,
  };
  const fallbackName = STATUS_NAMES[response.status] ?? `Error${response.status}`;

  if ((response.headers.get("content-type") ?? "").includes("application/problem+json")) {
    const status = typeof body["status"] === "number" ? body["status"] : response.status;
    const name = className !== undefined ? classNameToName(className) : (STATUS_NAMES[status] ?? fallbackName);
    const message = string("detail") ?? string("title") ?? response.statusText;
    return new MantleClientError(message, status, name, { ...fields, type: string("type") });
  }

  const code = typeof body["code"] === "number" ? body["code"] : response.status;
  return new MantleClientError(string("message") ?? response.statusText, code, string("name") ?? fallbackName, fields);
}
