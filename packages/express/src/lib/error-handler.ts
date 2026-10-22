import type { NextFunction, Request, Response } from "express";
import { errorResponseHeaders, MantleError } from "@mantlejs/mantle";

export function errorHandler() {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof MantleError) {
      // Hook headers were already set by the route (see routes.ts); the error's own headers win.
      res.set(errorResponseHeaders(undefined, err));
      res.status(err.code).json(err.toJSON());
      return;
    }
    res.status(500).json({
      name: "GeneralError",
      message: err instanceof Error ? err.message : "An unexpected error occurred",
      code: 500,
      className: "general-error",
    });
  };
}
