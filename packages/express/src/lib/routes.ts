import type { Application, NextFunction, Request, Response } from "express";
import type { MantleApplication, ServiceHandle, ServiceOptions, ServiceParams } from "@mantlejs/core";

const STANDARD_METHODS = new Set(["find", "get", "create", "update", "patch", "remove"]);

function buildParams(req: Request): ServiceParams {
  return {
    query: req.query as Record<string, unknown>,
    provider: "rest",
    headers: req.headers as Record<string, string>,
  };
}

export function mountServiceRoutes(
  expressApp: Application,
  app: MantleApplication,
  path: string,
  options: ServiceOptions,
): void {
  const methods = options.methods ?? ["find", "get", "create", "update", "patch", "remove"];
  const routePath = "/" + path.replace(/^\/+/, "");

  if (methods.includes("find")) {
    expressApp.get(routePath, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await app.service(path).find(buildParams(req));
        res.json(result);
      } catch (err) {
        next(err);
      }
    });
  }

  if (methods.includes("get")) {
    expressApp.get(`${routePath}/:__id`, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await app.service(path).get(req.params["__id"]!, buildParams(req));
        res.json(result);
      } catch (err) {
        next(err);
      }
    });
  }

  if (methods.includes("create")) {
    expressApp.post(routePath, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await app.service(path).create(req.body as Record<string, unknown>, buildParams(req));
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    });
  }

  if (methods.includes("update")) {
    expressApp.put(`${routePath}/:__id`, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await app
          .service(path)
          .update(req.params["__id"]!, req.body as Record<string, unknown>, buildParams(req));
        res.json(result);
      } catch (err) {
        next(err);
      }
    });
  }

  if (methods.includes("patch")) {
    expressApp.patch(`${routePath}/:__id`, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await app
          .service(path)
          .patch(req.params["__id"]!, req.body as Record<string, unknown>, buildParams(req));
        res.json(result);
      } catch (err) {
        next(err);
      }
    });
  }

  if (methods.includes("remove")) {
    expressApp.delete(`${routePath}/:__id`, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await app.service(path).remove(req.params["__id"]!, buildParams(req));
        res.json(result);
      } catch (err) {
        next(err);
      }
    });
  }

  for (const method of methods) {
    if (!STANDARD_METHODS.has(method)) {
      const customMethod = method;
      expressApp.post(`${routePath}/${customMethod}`, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const handle = app.service(path) as ServiceHandle<unknown>;
          const result = await handle.dispatch(customMethod, req.body as Record<string, unknown>, undefined, buildParams(req));
          res.json(result);
        } catch (err) {
          next(err);
        }
      });
    }
  }
}
