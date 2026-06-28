import { randomUUID } from "crypto";
import expressLib, { type Application, type RequestHandler } from "express";
import type { MantleApplication, MantlePlugin, ServiceOptions } from "@mantlejs/mantle";
import { withContext } from "@mantlejs/mantle";
import { mountServiceRoutes } from "./routes.js";
import { errorHandler } from "./error-handler.js";

export function express(existingApp?: Application): MantlePlugin {
  return (app: MantleApplication): void => {
    const expressApp: Application = existingApp ?? expressLib();
    expressApp.use(expressLib.json());
    expressApp.use((req, res, next) => {
      const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? randomUUID();
      res.setHeader("x-correlation-id", correlationId);
      withContext({ correlationId }, next);
    });
    app.set("express", expressApp);

    let errorHandlerAttached = false;

    function ensureErrorHandler(): void {
      if (!errorHandlerAttached) {
        errorHandlerAttached = true;
        expressApp.use(errorHandler());
      }
    }

    const originalUse = (app.use as unknown as (...args: unknown[]) => MantleApplication).bind(app);
    (app as unknown as Record<string, unknown>)["use"] = function (
      path: string | RequestHandler,
      service?: unknown,
      options?: ServiceOptions,
    ): MantleApplication {
      if (typeof path === "function") {
        expressApp.use(path as RequestHandler);
        return app;
      }
      originalUse(path, service, options);
      mountServiceRoutes(expressApp, app, path as string, options ?? {});
      // Defer error handler registration so it always sits after all routes
      setImmediate(ensureErrorHandler);
      return app;
    };

    (app as unknown as Record<string, unknown>)["listen"] = (port: number, callback?: () => void) => {
      ensureErrorHandler();
      return expressApp.listen(port, callback);
    };
  };
}
