import type { NextFunction, Request, Response } from "express";
import type { ErrorFormat } from "@mantlejs/mantle";
import { errorResponse, errorResponseHeaders } from "@mantlejs/mantle";

export interface ErrorHandlerOptions {
  /** Error body format: `"mantle"` (default, `MantleError.toJSON()`) or RFC 9457 `"problem+json"`. */
  errors?: ErrorFormat;
}

export function errorHandler(options: ErrorHandlerOptions = {}) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    // Hook headers were already set by the route (see routes.ts); the error's own headers win.
    res.set(errorResponseHeaders(undefined, err));
    const { status, contentType, body } = errorResponse(err, options.errors, {
      instance: req.path,
      requestId: res.locals["requestId"] as string | undefined,
    });
    res.status(status).set("Content-Type", contentType).send(JSON.stringify(body));
  };
}
