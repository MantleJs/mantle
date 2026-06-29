import { MantleError } from "@mantlejs/mantle";

export function toErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof MantleError) {
    return { status: err.code, body: err.toJSON() };
  }
  return {
    status: 500,
    body: {
      name: "GeneralError",
      message: err instanceof Error ? err.message : "An unexpected error occurred",
      code: 500,
      className: "general-error",
    },
  };
}
