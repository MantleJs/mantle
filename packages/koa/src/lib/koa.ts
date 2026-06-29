import { randomUUID } from "crypto";
import KoaLib from "koa";
import Router from "@koa/router";
import bodyParser from "@koa/bodyparser";
import type { MantleApplication, MantlePlugin, ServiceOptions } from "@mantlejs/mantle";
import { withContext } from "@mantlejs/mantle";
import { mountServiceRoutes } from "./routes.js";
import { errorHandler } from "./error-handler.js";

export interface KoaOptions {
  /** Existing Koa application instance. When omitted, a new one is created. */
  app?: InstanceType<typeof KoaLib>;
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
    app.set("koa", koaApp);
    app.set("koa:router", router);

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
      mountServiceRoutes(router, app, path, serviceOptions ?? {});
      return app;
    };

    (app as unknown as Record<string, unknown>)["listen"] = (port: number, callback?: () => void) => {
      koaApp.use(router.routes());
      koaApp.use(router.allowedMethods());
      const server = koaApp.listen(port, callback);
      app.set("server", server);
      return server;
    };
  };
}
