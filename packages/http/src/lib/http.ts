import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type {
  BatchCall,
  CorsOptions,
  HttpRequestLike,
  HttpResponseLike,
  HttpRouteHandler,
  HttpRouterLike,
  MantleApplication,
  MantlePlugin,
  ServiceOptions,
} from "@mantlejs/mantle";
import { withContext } from "@mantlejs/mantle";
import { Router, type RouteHandler } from "./router.js";
import { mountServiceRoutes } from "./routes.js";
import { parseBody } from "./body-parser.js";
import { toErrorResponse } from "./error-handler.js";
import { buildCorsHeaders } from "./cors.js";

export type NodeHttpHandler = (req: IncomingMessage, res: ServerResponse) => void;
export type FetchHandler = (request: Request) => Promise<Response>;

/** Convert URLSearchParams to a flat map, preserving repeated keys as arrays. */
function flattenSearchParams(searchParams: URLSearchParams): Record<string, string | string[]> {
  const flat: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams) {
    const existing = flat[key];
    if (existing === undefined) {
      flat[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      flat[key] = [existing, value];
    }
  }
  return flat;
}

async function dispatch(
  router: Router,
  method: string,
  pathname: string,
  query: Record<string, string | string[]>,
  headers: Record<string, string>,
  body: unknown,
  correlationId: string,
): Promise<{
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  raw?: boolean;
  correlationId: string;
}> {
  return withContext({ correlationId }, async () => {
    const matched = router.match(method, pathname);
    if (!matched) {
      return {
        status: 404,
        body: { name: "NotFound", message: "Not found", code: 404, className: "not-found" },
        correlationId,
      };
    }
    try {
      const result = await matched.entry.handler(matched.params, body, query, headers);
      return { ...result, correlationId };
    } catch (err) {
      const errRes = toErrorResponse(err);
      return { status: errRes.status, body: errRes.body, correlationId };
    }
  });
}

/** Adapt the internal Router to the transport-neutral express-style HttpRouterLike contract. */
function toHttpRouter(router: Router): HttpRouterLike {
  const adapt =
    (handler: HttpRouteHandler): RouteHandler =>
    async (_params, body, query, headers) => {
      let status = 200;
      let responseBody: unknown = null;
      let redirectUrl: string | undefined;
      let rawBody: string | undefined;

      const req: HttpRequestLike = {
        protocol: headers["x-forwarded-proto"] ?? "http",
        query,
        headers,
        body,
        get: (header) => headers[header.toLowerCase()],
      };
      const res: HttpResponseLike = {
        status(code) {
          status = code;
          return this;
        },
        json(body) {
          responseBody = body;
        },
        redirect(url) {
          redirectUrl = url;
        },
        send(body) {
          rawBody = body;
        },
      };

      await new Promise<void>((resolve, reject) => {
        const next = (err?: unknown): void => (err ? reject(err) : resolve());
        Promise.resolve(handler(req, res, next)).then(() => resolve(), reject);
      });

      if (redirectUrl !== undefined) {
        const headers: Record<string, string> = { Location: redirectUrl };
        return { status: 302, body: null, headers };
      }
      if (rawBody !== undefined) {
        const headers: Record<string, string> = {
          "Content-Type": rawBody.trimStart().startsWith("<") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        };
        return { status, body: rawBody, headers, raw: true };
      }
      return { status, body: responseBody };
    };

  return {
    get: (path, handler) => {
      router.add("GET", path, adapt(handler));
    },
    post: (path, handler) => {
      router.add("POST", path, adapt(handler));
    },
  };
}

export interface HttpOptions {
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
   * Enable CORS via hand-rolled header logic (no framework to delegate to). `true` resolves to
   * permissive defaults (reflects `Origin`, allows the CRUD verbs, no credentials); pass a
   * `CorsOptions` object to customize origin/methods/headers/credentials. `OPTIONS` preflight
   * requests short-circuit with a 204 before reaching the router. Disabled by default.
   */
  cors?: boolean | CorsOptions;
}

export function http(options: HttpOptions = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const router = new Router();
    const corsOptions: CorsOptions | null = options.cors ? (typeof options.cors === "object" ? options.cors : {}) : null;

    if (options.batch !== false) {
      const batchOptions = typeof options.batch === "object" ? options.batch : {};
      router.add("POST", batchOptions.path ?? "/batch", async (_params, body, _query, headers) => ({
        status: 200,
        body: await app.batch(
          body as BatchCall[],
          { provider: "http", headers },
          { maxSize: batchOptions.maxSize },
        ),
      }));
    }

    const servicePaths: string[] = [];
    if (options.introspection) {
      const introspectionPath =
        (typeof options.introspection === "object" ? options.introspection.path : undefined) ?? "/_services";
      router.add("GET", introspectionPath, async () => ({
        status: 200,
        body: servicePaths.map((path) => app.service(path).describe()),
      }));
    }

    const httpHandler: NodeHttpHandler = (req, res) => {
      void (async () => {
        let corsHeaders: Record<string, string> = {};
        if (corsOptions) {
          const cors = buildCorsHeaders(
            corsOptions,
            req.method ?? "GET",
            req.headers["origin"] as string | undefined,
            req.headers["access-control-request-headers"] as string | undefined,
          );
          corsHeaders = cors.headers;
          if (cors.isPreflight) {
            res.writeHead(204, corsHeaders);
            res.end();
            return;
          }
        }
        try {
          const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? randomUUID();
          const url = new URL(req.url ?? "/", "http://localhost");
          const query = flattenSearchParams(url.searchParams);
          const headers = req.headers as Record<string, string>;
          const body = await parseBody(req);
          const result = await dispatch(router, req.method ?? "GET", url.pathname, query, headers, body, correlationId);
          const payload = result.raw ? String(result.body) : JSON.stringify(result.body);
          res.writeHead(result.status, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "x-correlation-id": result.correlationId,
            ...corsHeaders,
            ...result.headers,
          });
          res.end(payload);
        } catch (err) {
          const errRes = toErrorResponse(err);
          const json = JSON.stringify(errRes.body);
          res.writeHead(errRes.status, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(json),
            ...corsHeaders,
          });
          res.end(json);
        }
      })();
    };

    const fetchHandler: FetchHandler = async (request) => {
      let corsHeaders: Record<string, string> = {};
      if (corsOptions) {
        const cors = buildCorsHeaders(
          corsOptions,
          request.method,
          request.headers.get("origin") ?? undefined,
          request.headers.get("access-control-request-headers") ?? undefined,
        );
        corsHeaders = cors.headers;
        if (cors.isPreflight) {
          return new Response(null, { status: 204, headers: corsHeaders });
        }
      }

      const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();
      const url = new URL(request.url);
      const query = flattenSearchParams(url.searchParams);
      const headers = Object.fromEntries(request.headers.entries());

      let body: unknown;
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        try {
          body = await request.json() as unknown;
        } catch {
          body = undefined;
        }
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        body = Object.fromEntries(new URLSearchParams(await request.text()));
      }

      const result = await dispatch(router, request.method, url.pathname, query, headers, body, correlationId);
      return new Response(result.raw ? String(result.body) : JSON.stringify(result.body), {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
          "x-correlation-id": result.correlationId,
          ...corsHeaders,
          ...result.headers,
        },
      });
    };

    app.set("httpHandler", httpHandler);
    app.set("fetchHandler", fetchHandler);
    // Transport-neutral contract — plugins mount raw routes via "http:router".
    app.set("http:router", toHttpRouter(router));

    const originalUse = (app.use as unknown as (...args: unknown[]) => MantleApplication).bind(app);
    (app as unknown as Record<string, unknown>)["use"] = function (
      path: string | unknown,
      service?: unknown,
      serviceOptions?: ServiceOptions,
    ): MantleApplication {
      if (typeof path !== "string") {
        return app;
      }
      originalUse(path, service, serviceOptions);
      servicePaths.push(path);
      mountServiceRoutes(router, app, path, serviceOptions ?? {});
      return app;
    };

    (app as unknown as Record<string, unknown>)["listen"] = (port: number, callback?: () => void): Server => {
      const server = createServer(httpHandler);
      server.listen(port, callback);
      app.set("http:server", server);
      /** @deprecated Read "http:server" instead. Kept for one release. */
      app.set("server", server);
      app.emit("http:server", server);
      return server;
    };
  };
}
