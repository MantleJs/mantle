import type { Context, Next } from "koa";
import type { ErrorFormat } from "@mantlejs/mantle";
import { errorResponse, errorResponseHeaders } from "@mantlejs/mantle";

export interface ErrorHandlerOptions {
  /** Error body format: RFC 9457 `"problem+json"` (default) or `"mantle"` (`MantleError.toJSON()`). */
  errors?: ErrorFormat;
}

/** Koa middleware mapping a thrown error to a Mantle error response in the given format. */
export function createErrorHandler(options: ErrorHandlerOptions = {}): (ctx: Context, next: Next) => Promise<void> {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      // Hook headers were already set by the route (see routes.ts); the error's own headers win.
      ctx.set(errorResponseHeaders(undefined, err));
      const { status, contentType, body } = errorResponse(err, options.errors, {
        instance: ctx.path,
        requestId: ctx.state["requestId"] as string | undefined,
      });
      ctx.status = status;
      ctx.body = body;
      ctx.type = contentType;
    }
  };
}

/** The default-format error middleware (Problem Details). Use `createErrorHandler({ errors: "mantle" })` for Mantle's JSON. */
export const errorHandler = createErrorHandler();
