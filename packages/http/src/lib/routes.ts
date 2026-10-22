import type { Id, MantleApplication, ServiceOptions, ServiceParams } from "@mantlejs/mantle";
import { parseQueryString } from "@mantlejs/mantle";
import type { RequestInfo, Router } from "./router.js";

const STANDARD_METHODS = new Set(["find", "get", "create", "update", "patch", "remove"]);

/** Params shared by service routes and the batch endpoint. */
export function requestParams(headers: Record<string, string>, request: RequestInfo): ServiceParams {
  return { provider: "http", headers, ip: request.ip, requestId: request.requestId };
}

function buildParams(
  query: Record<string, string | string[]>,
  headers: Record<string, string>,
  request: RequestInfo,
): ServiceParams {
  return { ...requestParams(headers, request), query: parseQueryString(query) };
}

interface RouteSpec {
  verb: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  suffix: string;
  status: number;
  withId: boolean;
  withBody: boolean;
}

const ROUTES: Record<string, RouteSpec> = {
  find: { verb: "GET", suffix: "", status: 200, withId: false, withBody: false },
  get: { verb: "GET", suffix: "/:__id", status: 200, withId: true, withBody: false },
  create: { verb: "POST", suffix: "", status: 201, withId: false, withBody: true },
  update: { verb: "PUT", suffix: "/:__id", status: 200, withId: true, withBody: true },
  patch: { verb: "PATCH", suffix: "/:__id", status: 200, withId: true, withBody: true },
  remove: { verb: "DELETE", suffix: "/:__id", status: 200, withId: true, withBody: false },
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
      : { verb: "POST", suffix: `/${method}`, status: 200, withId: false, withBody: true };

    router.add(spec.verb, routePath + spec.suffix, async (params, body, query, headers, request) => ({
      status: spec.status,
      body: await app
        .service(path)
        .dispatch(
          method,
          spec.withBody ? (body as Record<string, unknown>) : undefined,
          spec.withId ? ((params["__id"] ?? "") as Id) : undefined,
          buildParams(query, headers, request),
          { response: request.response },
        ),
    }));
  }
}
