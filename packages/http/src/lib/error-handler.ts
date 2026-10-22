import { errorResponseHeaders, MantleError } from "@mantlejs/mantle";
import type { HttpResponseMeta } from "@mantlejs/mantle";

/** `response` holds headers hooks set before the error; the error's own `MantleError.headers` win. */
export function toErrorResponse(
  err: unknown,
  response?: HttpResponseMeta,
): { status: number; body: Record<string, unknown>; headers: Record<string, string> } {
  const headers = errorResponseHeaders(response, err);
  if (err instanceof MantleError) {
    return { status: err.code, body: err.toJSON(), headers };
  }
  return {
    status: 500,
    headers,
    body: {
      name: "GeneralError",
      message: err instanceof Error ? err.message : "An unexpected error occurred",
      code: 500,
      className: "general-error",
    },
  };
}
