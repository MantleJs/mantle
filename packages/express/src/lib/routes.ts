import type { Application, NextFunction, Request, Response } from "express";
import type { HttpResponseMeta, Id, MantleApplication, ServiceOptions, ServiceParams } from "@mantlejs/mantle";
import { parseQueryString, successResponse } from "@mantlejs/mantle";

const STANDARD_METHODS = new Set(["find", "get", "create", "update", "patch", "remove"]);

/** Params shared by service routes and the batch endpoint. `res.locals` is filled by the request-ID middleware. */
export function requestParams(req: Request, res: Response): ServiceParams {
  return {
    provider: "rest",
    headers: req.headers as Record<string, string>,
    request: req,
    ip: res.locals["ip"] as string | undefined,
    requestId: res.locals["requestId"] as string,
  };
}

function buildParams(req: Request, res: Response): ServiceParams {
  // Express 5's default "simple" parser leaves bracket keys flat; run the canonical
  // Mantle parser so every transport produces identical params.query.
  return { ...requestParams(req, res), query: parseQueryString(req.query as Record<string, string | string[]>) };
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
  expressApp: Application,
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

    expressApp[spec.verb](routePath + spec.suffix, async (req: Request, res: Response, next: NextFunction) => {
      const response: HttpResponseMeta = {};
      try {
        const result = await app
          .service(path)
          .dispatch(
            method,
            spec.withBody ? (req.body as Record<string, unknown>) : undefined,
            spec.withId ? (req.params["__id"] as Id) : undefined,
            buildParams(req, res),
            { response },
          );
        const { status, headers, bodyless } = successResponse(response, spec.status);
        res.set(headers).status(status);
        if (bodyless) res.end();
        else res.json(result);
      } catch (err) {
        res.set(response.headers ?? {});
        next(err);
      }
    });
  }
}
