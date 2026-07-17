import { randomUUID } from "crypto";
import KoaLib from "koa";
import Router from "@koa/router";
import bodyParser from "@koa/bodyparser";
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
import { mountServiceRoutes } from "./routes.js";
import { errorHandler } from "./error-handler.js";

export interface KoaOptions {
  /** Existing Koa application instance. When omitted, a new one is created. */
  app?: InstanceType<typeof KoaLib>;
  /**
   * Mount an introspection endpoint (default `GET /_services`) returning a
   * `ServiceDescriptor[]` for every registered service. Off by default.
   */
  introspection?: boolean | { path?: string };
}

/** Structural subset of Koa's context used by the HttpRouterLike adapter. */
interface KoaCtxLike {
  protocol: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  status: number;
  body: unknown;
  get(field: string): string;
  redirect(url: string): void;
}

/** Adapt @koa/router to the transport-neutral express-style HttpRouterLike contract. */
function toHttpRouter(router: Router): HttpRouterLike {
  const adapt =
    (handler: HttpRouteHandler) =>
    async (ctx: KoaCtxLike): Promise<void> => {
      const req: HttpRequestLike = {
        protocol: ctx.protocol,
        query: ctx.query as Record<string, unknown>,
        headers: ctx.headers as Record<string, string | string[] | undefined>,
        get: (header) => ctx.get(header) || undefined,
      };
      const res: HttpResponseLike = {
        status(code) {
          ctx.status = code;
          return this;
        },
        json(body) {
          ctx.body = body;
        },
        redirect(url) {
          ctx.redirect(url);
        },
        send(body) {
          // Koa infers text/html for strings starting with "<", text/plain otherwise.
          ctx.body = body;
        },
      };
      await new Promise<void>((resolve, reject) => {
        const next = (err?: unknown): void => (err ? reject(err) : resolve());
        Promise.resolve(handler(req, res, next)).then(() => resolve(), reject);
      });
    };

  return {
    get: (path, handler) => {
      router.get(path, adapt(handler));
    },
    post: (path, handler) => {
      router.post(path, adapt(handler));
    },
  };
}

export function koa(options: KoaOptions = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const koaApp: InstanceType<typeof KoaLib> = options.app ?? new KoaLib();

    koaApp.use(errorHandler);
    koaApp.use(bodyParser());
    koaApp.use(async (ctx, next) => {
      const correlationId =
        (ctx.get("x-correlation-id") as string | undefined) || randomUUID();
      ctx.set("x-correlation-id", correlationId);
      await withContext({ correlationId }, next);
    });

    const router = new Router();
    // Transport-neutral contract — plugins mount raw routes via "http:router".
    app.set("http:router", toHttpRouter(router));
    /** @deprecated Read "http:router" / "http:server" instead. Kept for one release. */
    app.set("koa", koaApp);
    app.set("koa:router", router);

    const servicePaths: string[] = [];
    if (options.introspection) {
      const introspectionPath =
        (typeof options.introspection === "object" ? options.introspection.path : undefined) ?? "/_services";
      router.get(introspectionPath, (ctx: KoaCtxLike) => {
        ctx.status = 200;
        ctx.body = servicePaths.map((path) => app.service(path).describe());
      });
    }

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

    (app as unknown as Record<string, unknown>)["listen"] = (port: number, callback?: () => void) => {
      koaApp.use(router.routes());
      koaApp.use(router.allowedMethods());
      const server = koaApp.listen(port, callback);
      app.set("http:server", server);
      /** @deprecated Read "http:server" instead. Kept for one release. */
      app.set("server", server);
      app.emit("http:server", server);
      return server;
    };
  };
}
