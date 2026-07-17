export type RouteHandler = (
  params: Record<string, string>,
  body: unknown,
  query: Record<string, string | string[]>,
  headers: Record<string, string>,
) => Promise<{
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** When true, `body` is a pre-serialized string sent as-is (Content-Type comes from `headers`). */
  raw?: boolean;
}>;

interface RouteEntry {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: RouteEntry[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexStr = path.replace(/:([^/]+)/g, (_: string, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    });
  }

  match(method: string, pathname: string): { entry: RouteEntry; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? "");
      });
      return { entry: route, params };
    }
    return null;
  }
}
