import type { HttpRouterLike, MantleApplication, MantlePlugin, ServiceOptions } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { buildOpenApiDocument, type OpenApiInfo } from "./document.js";
import { swaggerUiHtml } from "./swagger-ui.js";

export interface OpenApiOptions {
  /** Route the OpenAPI 3.1 JSON document is served from. @default "/openapi.json" */
  specPath?: string;
  /** When set, serves a Swagger UI page at this route. Off by default. */
  docsPath?: string;
  /** Document metadata (`info` object). */
  info?: OpenApiInfo;
}

/**
 * OpenAPI 3.1 generation plugin. Walks every service registered after it via
 * `ServiceHandle.describe()` and serves the assembled document at `specPath`.
 *
 * Configure it AFTER the HTTP transport (it mounts routes through the
 * transport-neutral `"http:router"`) and BEFORE registering services:
 *
 * ```ts
 * const app = mantle()
 *   .configure(express())
 *   .configure(openapi({ docsPath: "/docs" }));
 * app.use("users", new UserService(), { schema: userSchema });
 * ```
 *
 * The document is rebuilt per request, so hooks registered later (e.g.
 * `authenticate("jwt")` marking a service as requiring `bearerAuth`) are picked up.
 */
export function openapi(options: OpenApiOptions = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const router = app.get<HttpRouterLike | undefined>("http:router");
    if (!router) {
      throw new GeneralError("openapi() requires an HTTP transport — configure express(), koa(), or http() first");
    }

    const specPath = options.specPath ?? "/openapi.json";
    const servicePaths: string[] = [];

    const originalUse = (app.use as unknown as (...args: unknown[]) => MantleApplication).bind(app);
    (app as unknown as Record<string, unknown>)["use"] = function (
      path: unknown,
      service?: unknown,
      serviceOptions?: ServiceOptions,
    ): MantleApplication {
      const result = originalUse(path, service, serviceOptions);
      if (typeof path === "string") {
        servicePaths.push(path.replace(/^\//, ""));
      }
      return result;
    };

    router.get(specPath, (_req, res) => {
      const descriptors = servicePaths.map((path) => app.service(path).describe());
      res.json(buildOpenApiDocument(descriptors, options.info));
    });

    if (options.docsPath !== undefined) {
      const docsPath = options.docsPath;
      router.get(docsPath, (_req, res) => {
        if (typeof res.send === "function") {
          res.send(swaggerUiHtml(specPath, options.info?.title ?? "Mantle API"));
        } else {
          // Transport without raw-body support — point the caller at the spec instead.
          res.json({ openapi: specPath });
        }
      });
    }
  };
}
