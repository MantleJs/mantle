import type { Context, Next } from "koa";
import { errorResponseHeaders, MantleError } from "@mantlejs/mantle";

export async function errorHandler(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (err) {
    if (err instanceof MantleError) {
      // Hook headers were already set by the route (see routes.ts); the error's own headers win.
      ctx.set(errorResponseHeaders(undefined, err));
      ctx.status = err.code;
      ctx.body = err.toJSON();
      return;
    }
    ctx.status = 500;
    ctx.body = {
      name: "GeneralError",
      message: err instanceof Error ? err.message : "An unexpected error occurred",
      code: 500,
      className: "general-error",
    };
  }
}
