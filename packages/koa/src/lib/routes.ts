import Router from "@koa/router";
import type { Context } from "koa";
import type { MantleApplication, ServiceHandle, ServiceOptions, ServiceParams } from "@mantlejs/mantle";

const STANDARD_METHODS = new Set(["find", "get", "create", "update", "patch", "remove"]);

function buildParams(ctx: Context): ServiceParams {
  return {
    query: ctx.query as Record<string, unknown>,
    provider: "koa",
    headers: ctx.headers as Record<string, string>,
    request: ctx.req,
  };
}

export function mountServiceRoutes(router: Router, app: MantleApplication, path: string, options: ServiceOptions): void {
  const methods = options.methods ?? ["find", "get", "create", "update", "patch", "remove"];
  const routePath = "/" + path.replace(/^\/+/, "");

  if (methods.includes("find")) {
    router.get(routePath, async (ctx) => {
      ctx.body = await app.service(path).find(buildParams(ctx));
    });
  }

  if (methods.includes("get")) {
    router.get(`${routePath}/:__id`, async (ctx) => {
      ctx.body = await app.service(path).get(ctx.params["__id"] as string, buildParams(ctx));
    });
  }

  if (methods.includes("create")) {
    router.post(routePath, async (ctx) => {
      ctx.status = 201;
      ctx.body = await app.service(path).create(ctx.request.body as Record<string, unknown>, buildParams(ctx));
    });
  }

  if (methods.includes("update")) {
    router.put(`${routePath}/:__id`, async (ctx) => {
      ctx.body = await app
        .service(path)
        .update(ctx.params["__id"] as string, ctx.request.body as Record<string, unknown>, buildParams(ctx));
    });
  }

  if (methods.includes("patch")) {
    router.patch(`${routePath}/:__id`, async (ctx) => {
      ctx.body = await app
        .service(path)
        .patch(ctx.params["__id"] as string, ctx.request.body as Record<string, unknown>, buildParams(ctx));
    });
  }

  if (methods.includes("remove")) {
    router.delete(`${routePath}/:__id`, async (ctx) => {
      ctx.body = await app.service(path).remove(ctx.params["__id"] as string, buildParams(ctx));
    });
  }

  for (const method of methods) {
    if (!STANDARD_METHODS.has(method)) {
      const customMethod = method;
      router.post(`${routePath}/${customMethod}`, async (ctx) => {
        const handle = app.service(path) as ServiceHandle<unknown>;
        ctx.body = await handle.dispatch(customMethod, ctx.request.body as Record<string, unknown>, undefined, buildParams(ctx));
      });
    }
  }
}
