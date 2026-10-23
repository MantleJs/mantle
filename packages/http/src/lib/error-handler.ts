import type { ErrorFormat, HttpResponseMeta } from "@mantlejs/mantle";
import { errorResponse, errorResponseHeaders } from "@mantlejs/mantle";

export interface ToErrorResponseOptions {
  /** Error body format: `"mantle"` (default, `MantleError.toJSON()`) or RFC 9457 `"problem+json"`. */
  errors?: ErrorFormat;
  /** Request path, used as Problem Details' `instance`. */
  instance?: string;
  requestId?: string;
}

/**
 * Map an error to the status, body, and headers to send. `response` holds headers hooks set before the error; the
 * error's own `MantleError.headers` win. `headers` includes the `Content-Type` for the chosen format.
 */
export function toErrorResponse(
  err: unknown,
  response?: HttpResponseMeta,
  options: ToErrorResponseOptions = {},
): { status: number; body: Record<string, unknown>; headers: Record<string, string> } {
  const { status, contentType, body } = errorResponse(err, options.errors, {
    instance: options.instance,
    requestId: options.requestId,
  });
  return { status, body, headers: { ...errorResponseHeaders(response, err), "Content-Type": contentType } };
}
