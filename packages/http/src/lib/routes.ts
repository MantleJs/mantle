import type { MantleApplication, ServiceHandle, ServiceOptions, ServiceParams } from "@mantlejs/mantle";
import { parseQueryString } from "@mantlejs/mantle";
import type { Router } from "./router.js";

const STANDARD_METHODS = new Set(["find", "get", "create", "update", "patch", "remove"]);

function buildParams(query: Record<string, string | string[]>, headers: Record<string, string>): ServiceParams {
  return {
    query: parseQueryString(query),
    provider: "http",
    headers,
  };
}

export function mountServiceRoutes(router: Router, app: MantleApplication, path: string, options: ServiceOptions): void {
  const methods = options.methods ?? ["find", "get", "create", "update", "patch", "remove"];
  const routePath = "/" + path.replace(/^\/+/, "");

  if (methods.includes("find")) {
    router.add("GET", routePath, async (_params, _body, query, headers) => ({
      status: 200,
      body: await app.service(path).find(buildParams(query, headers)),
    }));
  }

  if (methods.includes("get")) {
    router.add("GET", `${routePath}/:__id`, async (params, _body, query, headers) => ({
      status: 200,
      body: await app.service(path).get(params["__id"] ?? "", buildParams(query, headers)),
    }));
  }

  if (methods.includes("create")) {
    router.add("POST", routePath, async (_params, body, query, headers) => ({
      status: 201,
      body: await app.service(path).create(body as Record<string, unknown>, buildParams(query, headers)),
    }));
  }

  if (methods.includes("update")) {
    router.add("PUT", `${routePath}/:__id`, async (params, body, query, headers) => ({
      status: 200,
      body: await app.service(path).update(params["__id"] ?? "", body as Record<string, unknown>, buildParams(query, headers)),
    }));
  }

  if (methods.includes("patch")) {
    router.add("PATCH", `${routePath}/:__id`, async (params, body, query, headers) => ({
      status: 200,
      body: await app.service(path).patch(params["__id"] ?? "", body as Record<string, unknown>, buildParams(query, headers)),
    }));
  }

  if (methods.includes("remove")) {
    router.add("DELETE", `${routePath}/:__id`, async (params, _body, query, headers) => ({
      status: 200,
      body: await app.service(path).remove(params["__id"] ?? "", buildParams(query, headers)),
    }));
  }

  for (const method of methods) {
    if (!STANDARD_METHODS.has(method)) {
      const customMethod = method;
      router.add("POST", `${routePath}/${customMethod}`, async (_params, body, query, headers) => {
        const handle = app.service(path) as ServiceHandle<unknown>;
        return {
          status: 200,
          body: await handle.dispatch(customMethod, body as Record<string, unknown>, undefined, buildParams(query, headers)),
        };
      });
    }
  }
}
