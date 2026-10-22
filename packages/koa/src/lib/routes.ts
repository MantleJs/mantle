import Router from "@koa/router";
import type { Context } from "koa";
import type { HttpResponseMeta, Id, MantleApplication, ServiceOptions, ServiceParams } from "@mantlejs/mantle";
import { parseQueryString, successResponse } from "@mantlejs/mantle";

const STANDARD_METHODS = new Set(["find", "get", "create", "update", "patch", "remove"]);

/** Params shared by service routes and the batch endpoint. `ctx.state` is filled by the request-ID middleware. */
export function requestParams(ctx: Context): ServiceParams {
  return {
    provider: "koa",
    headers: ctx.headers as Record<string, string>,
    request: ctx.req,
    ip: ctx.state["ip"] as string | undefined,
    requestId: ctx.state["requestId"] as string,
  };
}

function buildParams(ctx: Context): ServiceParams {
  return { ...requestParams(ctx), query: parseQueryString(ctx.query as Record<string, string | string[]>) };
}

interface RouteSpec {
  verb: "get" | "post" | "put" | "patch" | "delete";
  suffix: string;
  status: number;
  withId: boolean;
  withBody: boolean;
}

const ROUTES: Record<string, RouteSpec> = {
  find: { verb: "get", suffix: "", status: 200, withId: false, withBody: false },
  get: { verb: "get", suffix: "/:__id", status: 200, withId: true, withBody: false },
  create: { verb: "post", suffix: "", status: 201, withId: false, withBody: true },
  update: { verb: "put", suffix: "/:__id", status: 200, withId: true, withBody: true },
  patch: { verb: "patch", suffix: "/:__id", status: 200, withId: true, withBody: true },
  remove: { verb: "delete", suffix: "/:__id", status: 200, withId: true, withBody: false },
};

export function mountServiceRoutes(
  router: Router,
  app: MantleApplication,
  path: string,
  options: ServiceOptions,
): void {
  const methods = options.methods ?? ["find", "get", "create", "update", "patch", "remove"];
  const routePath = "/" + path.replace(/^\/+/, "");

  for (const method of methods) {
    // Custom methods dispatch as (data, params) via POST /path/<method>.
    const spec: RouteSpec = STANDARD_METHODS.has(method)
      ? (ROUTES[method] as RouteSpec)
      : { verb: "post", suffix: `/${method}`, status: 200, withId: false, withBody: true };

    router[spec.verb](routePath + spec.suffix, async (ctx) => {
      const response: HttpResponseMeta = {};
      try {
        const result = await app
          .service(path)
          .dispatch(
            method,
            spec.withBody ? (ctx.request.body as Record<string, unknown>) : undefined,
            spec.withId ? (ctx.params["__id"] as Id) : undefined,
            buildParams(ctx),
            { response },
          );
        const { status, headers, bodyless } = successResponse(response, spec.status);
        ctx.set(headers);
        ctx.status = status;
        if (!bodyless) ctx.body = result;
      } catch (err) {
        ctx.set(response.headers ?? {});
        throw err;
      }
    });
  }
}
