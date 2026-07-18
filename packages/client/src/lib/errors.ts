/** HTTP status → Mantle error-class name, used when the response body carries no `name`. */
const STATUS_NAMES: Record<number, string> = {
  400: "BadRequest",
  401: "NotAuthenticated",
  403: "Forbidden",
  404: "NotFound",
  405: "MethodNotAllowed",
  409: "Conflict",
  422: "Unprocessable",
  500: "GeneralError",
};

export interface MantleClientErrorFields {
  className?: string;
  data?: unknown;
  errors?: unknown[];
  hint?: string;
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

  constructor(message: string, code: number, name: string, fields: MantleClientErrorFields = {}) {
    super(message);
    this.name = name;
    this.code = code;
    this.className = fields.className;
    this.data = fields.data;
    this.errors = fields.errors;
    this.hint = fields.hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Deserialize a non-2xx `Response` into a `MantleClientError`. Falls back to
 * the HTTP status alone when the body is not Mantle's error JSON (e.g. a
 * gateway error page).
 */
export async function errorFromResponse(response: Response): Promise<MantleClientError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed !== null && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON body — construct from the status line alone.
  }
  const code = typeof body["code"] === "number" ? body["code"] : response.status;
  const name =
    typeof body["name"] === "string" ? body["name"] : (STATUS_NAMES[response.status] ?? `Error${response.status}`);
  const message = typeof body["message"] === "string" ? body["message"] : response.statusText;
  return new MantleClientError(message, code, name, {
    className: typeof body["className"] === "string" ? body["className"] : undefined,
    data: body["data"],
    errors: Array.isArray(body["errors"]) ? body["errors"] : undefined,
    hint: typeof body["hint"] === "string" ? body["hint"] : undefined,
  });
}
