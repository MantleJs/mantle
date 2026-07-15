import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type {
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
): Promise<{ status: number; body: unknown; headers?: Record<string, string>; correlationId: string }> {
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
    async (_params, _body, query, headers) => {
      let status = 200;
      let responseBody: unknown = null;
      let redirectUrl: string | undefined;

      const req: HttpRequestLike = {
        protocol: headers["x-forwarded-proto"] ?? "http",
        query,
        headers,
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
      };

      await new Promise<void>((resolve, reject) => {
        const next = (err?: unknown): void => (err ? reject(err) : resolve());
        Promise.resolve(handler(req, res, next)).then(() => resolve(), reject);
      });

      if (redirectUrl !== undefined) {
        return { status: 302, body: null, headers: { Location: redirectUrl } };
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
}

export function http(options: HttpOptions = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const router = new Router();

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
        try {
          const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? randomUUID();
          const url = new URL(req.url ?? "/", "http://localhost");
          const query = flattenSearchParams(url.searchParams);
          const headers = req.headers as Record<string, string>;
          const body = await parseBody(req);
          const result = await dispatch(router, req.method ?? "GET", url.pathname, query, headers, body, correlationId);
          const json = JSON.stringify(result.body);
          res.writeHead(result.status, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(json),
            "x-correlation-id": result.correlationId,
            ...result.headers,
          });
          res.end(json);
        } catch (err) {
          const errRes = toErrorResponse(err);
          const json = JSON.stringify(errRes.body);
          res.writeHead(errRes.status, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(json),
          });
          res.end(json);
        }
      })();
    };

    const fetchHandler: FetchHandler = async (request) => {
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
      }

      const result = await dispatch(router, request.method, url.pathname, query, headers, body, correlationId);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
          "x-correlation-id": result.correlationId,
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
