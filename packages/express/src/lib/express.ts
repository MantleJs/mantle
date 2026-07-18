import { randomUUID } from "crypto";
import expressLib, { type Application, type RequestHandler } from "express";
import type { BatchCall, MantleApplication, MantlePlugin, ServiceOptions } from "@mantlejs/mantle";
import { withContext } from "@mantlejs/mantle";
import { mountServiceRoutes } from "./routes.js";
import { errorHandler } from "./error-handler.js";

export interface ExpressOptions {
  /**
   * Mount an introspection endpoint (default `GET /_services`) returning a
   * `ServiceDescriptor[]` for every registered service. Off by default.
   */
  introspection?: boolean | { path?: string };
  /**
   * Mount a batch endpoint (default `POST /batch`) dispatching a `BatchCall[]` body through
   * `app.batch()` — every call runs its service's full hook pipeline. On by default;
   * `false` disables it, an object overrides the route path or max batch size (default 25).
   */
  batch?: boolean | { path?: string; maxSize?: number };
}

export function express(existingApp?: Application, options: ExpressOptions = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const expressApp: Application = existingApp ?? expressLib();
    expressApp.use(expressLib.json());
    expressApp.use((req, res, next) => {
      const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? randomUUID();
      res.setHeader("x-correlation-id", correlationId);
      withContext({ correlationId }, next);
    });
    // Transport-neutral contract — plugins mount raw routes via "http:router".
    app.set("http:router", expressApp);
    /** @deprecated Read "http:router" instead. Kept for one release. */
    app.set("express", expressApp);

    const servicePaths: string[] = [];
    if (options.introspection) {
      const introspectionPath =
        (typeof options.introspection === "object" ? options.introspection.path : undefined) ?? "/_services";
      expressApp.get(introspectionPath, (_req, res) => {
        res.json(servicePaths.map((path) => app.service(path).describe()));
      });
    }

    let errorHandlerAttached = false;

    function ensureErrorHandler(): void {
      if (!errorHandlerAttached) {
        errorHandlerAttached = true;
        expressApp.use(errorHandler());
      }
    }

    if (options.batch !== false) {
      const batchOptions = typeof options.batch === "object" ? options.batch : {};
      expressApp.post(batchOptions.path ?? "/batch", async (req, res, next) => {
        try {
          const results = await app.batch(
            req.body as BatchCall[],
            { provider: "rest", headers: req.headers as Record<string, string>, request: req },
            { maxSize: batchOptions.maxSize },
          );
          res.json(results);
        } catch (err) {
          next(err);
        }
      });
      setImmediate(ensureErrorHandler);
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
      servicePaths.push(path as string);
      mountServiceRoutes(expressApp, app, path as string, options ?? {});
      // Defer error handler registration so it always sits after all routes
      setImmediate(ensureErrorHandler);
      return app;
    };

    (app as unknown as Record<string, unknown>)["listen"] = (port: number, callback?: () => void) => {
      ensureErrorHandler();
      const server = expressApp.listen(port, callback);
      app.set("http:server", server);
      app.emit("http:server", server);
      return server;
    };
  };
}
