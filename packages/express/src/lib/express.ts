import type { Server } from "node:http";
import expressLib, { type Application, type RequestHandler } from "express";
import corsLib from "cors";
import type {
  BatchCall,
  CorsOptions,
  MantleApplication,
  MantlePlugin,
  ServiceOptions,
  TrustProxy,
} from "@mantlejs/mantle";
import {
  CORS_DEFAULT_EXPOSED_HEADERS,
  CORS_DEFAULT_METHODS,
  createRequestContext,
  requestIdHeaders,
  resolveClientIp,
  resolveCorsOrigin,
  resolveRequestId,
  withContext,
} from "@mantlejs/mantle";
import { mountServiceRoutes, requestParams } from "./routes.js";
import { errorHandler } from "./error-handler.js";

declare module "@mantlejs/mantle" {
  interface MantleApplication {
    /** Added by `@mantlejs/express` — starts the underlying `http.Server`. */
    listen(port: number, callback?: () => void): Server;
  }
}

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
  /**
   * Enable CORS via the `cors` npm package. `true` resolves to permissive defaults (reflects
   * `Origin`, allows the CRUD verbs, no credentials); pass a `CorsOptions` object to customize
   * origin/methods/headers/credentials. Disabled (no CORS headers) by default.
   */
  cors?: boolean | CorsOptions;
  /**
   * Which proxies to trust when resolving `params.ip` from `X-Forwarded-For`. `false` (default) uses the
   * socket peer; `true` the header's leftmost entry; a number that many proxy hops (e.g. `1` behind one
   * load balancer). Independent of Express's own `trust proxy` setting. See `TrustProxy`.
   */
  trustProxy?: TrustProxy;
}

export function express(existingApp?: Application, options: ExpressOptions = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const expressApp: Application = existingApp ?? expressLib();

    if (options.cors) {
      const corsOptions: CorsOptions = typeof options.cors === "object" ? options.cors : {};
      expressApp.use(
        corsLib({
          origin: (requestOrigin, callback) => {
            callback(null, resolveCorsOrigin(corsOptions.origin, requestOrigin) ?? false);
          },
          methods: corsOptions.methods ?? CORS_DEFAULT_METHODS,
          allowedHeaders: corsOptions.allowedHeaders,
          exposedHeaders: corsOptions.exposedHeaders ?? CORS_DEFAULT_EXPOSED_HEADERS,
          credentials: corsOptions.credentials ?? false,
          maxAge: corsOptions.maxAge,
        }),
      );
    }

    // Before the body parsers, so a malformed-body error response still carries the request ID.
    expressApp.use((req, res, next) => {
      const resolved = resolveRequestId((name) => req.headers[name]);
      res.locals["requestId"] = resolved.requestId;
      res.locals["ip"] = resolveClientIp(req.socket.remoteAddress, req.headers["x-forwarded-for"], options.trustProxy);
      res.set(requestIdHeaders(resolved));
      withContext(createRequestContext(resolved.requestId), next);
    });
    expressApp.use(expressLib.json());
    expressApp.use(expressLib.urlencoded({ extended: false }));
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
          const results = await app.batch(req.body as BatchCall[], requestParams(req, res), {
            maxSize: batchOptions.maxSize,
          });
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
