import { BadRequest, GeneralError, MethodNotAllowed, NotFound } from "./errors.js";
import type {
  HookConfig,
  HookContext,
  HookFunction,
  Id,
  MantleApplication,
  MantlePlugin,
  Paginated,
  Service,
  ServiceHandle,
  ServiceOptions,
  ServiceParams,
} from "./types.js";

const DEFAULT_METHODS = ["find", "get", "create", "update", "patch", "remove"];
const DEFAULT_EVENTS = ["created", "updated", "patched", "removed"];

async function runHookChain<T>(hooks: HookFunction<T>[], ctx: HookContext<T>): Promise<HookContext<T>> {
  let current = ctx;
  for (const hook of hooks) {
    current = await hook(current);
  }
  return current;
}

class ServiceHandleImpl<T> implements ServiceHandle<T> {
  private hookConfig: HookConfig<T> = {};

  constructor(
    private readonly service: Partial<Service<T>>,
    private readonly path: string,
    private readonly app: MantleApplication,
    private readonly options: Required<ServiceOptions>,
  ) {}

  hooks(config: HookConfig<T>): this {
    this.hookConfig = config;
    return this;
  }

  private makeContext(method: string, params?: ServiceParams, id?: Id, data?: Partial<T>): HookContext<T> {
    return {
      app: this.app,
      service: this.service,
      path: this.path,
      method,
      params: params ?? {},
      id,
      data,
    };
  }

  private getPhaseHooks(phase: "before" | "after" | "error", method: string): HookFunction<T>[] {
    const phaseMap = this.hookConfig[phase] as Record<string, HookFunction<T>[] | undefined> | undefined;
    if (!phaseMap) return [];
    return [...(phaseMap["all"] ?? []), ...(phaseMap[method] ?? [])];
  }

  private async callServiceMethod(ctx: HookContext<T>): Promise<T | T[] | Paginated<T>> {
    if (!this.options.methods.includes(ctx.method)) {
      throw new MethodNotAllowed(`Method '${ctx.method}' is not allowed on service '${ctx.path}'`);
    }

    const method = ctx.method as keyof Service<T>;
    const fn = this.service[method];
    if (typeof fn !== "function") {
      throw new MethodNotAllowed(`Method '${ctx.method}' is not implemented on service '${ctx.path}'`);
    }

    switch (method) {
      case "find":
        return (fn as Service<T>["find"]).call(this.service, ctx.params);
      case "create":
        return (fn as Service<T>["create"]).call(this.service, ctx.data as Partial<T>, ctx.params);
      case "get": {
        const id = ctx.id;
        if (id === undefined) throw new BadRequest("'id' is required for get");
        return (fn as Service<T>["get"]).call(this.service, id, ctx.params);
      }
      case "update": {
        const id = ctx.id;
        if (id === undefined) throw new BadRequest("'id' is required for update");
        return (fn as Service<T>["update"]).call(this.service, id, ctx.data as Partial<T>, ctx.params);
      }
      case "patch": {
        const id = ctx.id;
        if (id === undefined) throw new BadRequest("'id' is required for patch");
        return (fn as Service<T>["patch"]).call(this.service, id, ctx.data as Partial<T>, ctx.params);
      }
      case "remove": {
        const id = ctx.id;
        if (id === undefined) throw new BadRequest("'id' is required for remove");
        return (fn as Service<T>["remove"]).call(this.service, id, ctx.params);
      }
      default:
        throw new MethodNotAllowed(`Method '${ctx.method}' is not a standard service method`);
    }
  }

  private async runPipeline(
    method: string,
    params?: ServiceParams,
    id?: Id,
    data?: Partial<T>,
  ): Promise<T | T[] | Paginated<T>> {
    let ctx = this.makeContext(method, params, id, data);

    try {
      ctx = await runHookChain(this.getPhaseHooks("before", method), ctx);

      if (ctx.result === undefined) {
        ctx.result = await this.callServiceMethod(ctx);
      }

      ctx = await runHookChain(this.getPhaseHooks("after", method), ctx);

      return ctx.result as T | T[] | Paginated<T>;
    } catch (error) {
      ctx.error = error instanceof Error ? error : new GeneralError(String(error));
      ctx = await runHookChain(this.getPhaseHooks("error", method), ctx);
      if (ctx.error) throw ctx.error;
      return ctx.result as T | T[] | Paginated<T>;
    }
  }

  async find(params?: ServiceParams): Promise<T[] | Paginated<T>> {
    return this.runPipeline("find", params) as Promise<T[] | Paginated<T>>;
  }

  async get(id: Id, params?: ServiceParams): Promise<T> {
    return this.runPipeline("get", params, id) as Promise<T>;
  }

  async create(data: Partial<T>, params?: ServiceParams): Promise<T> {
    return this.runPipeline("create", params, undefined, data) as Promise<T>;
  }

  async update(id: Id, data: Partial<T>, params?: ServiceParams): Promise<T> {
    return this.runPipeline("update", params, id, data) as Promise<T>;
  }

  async patch(id: Id, data: Partial<T>, params?: ServiceParams): Promise<T> {
    return this.runPipeline("patch", params, id, data) as Promise<T>;
  }

  async remove(id: Id, params?: ServiceParams): Promise<T> {
    return this.runPipeline("remove", params, id) as Promise<T>;
  }
}

export class MantleApplicationImpl implements MantleApplication {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _services = new Map<string, ServiceHandleImpl<any>>();
  private readonly _settings = new Map<string, unknown>();

  use<T = unknown>(path: string, service: Partial<Service<T>>, options: ServiceOptions = {}): this {
    const key = path.replace(/^\//, "");
    const handle = new ServiceHandleImpl<T>(service, key, this, {
      methods: options.methods ?? DEFAULT_METHODS,
      events: options.events ?? DEFAULT_EVENTS,
    });
    this._services.set(key, handle);
    return this;
  }

  service<T = unknown>(path: string): ServiceHandle<T> {
    const key = path.replace(/^\//, "");
    const handle = this._services.get(key);
    if (!handle) throw new NotFound(`Service '${key}' is not registered`);
    return handle as ServiceHandle<T>;
  }

  configure(plugin: MantlePlugin): this {
    void plugin(this);
    return this;
  }

  set(key: string, value: unknown): this {
    this._settings.set(key, value);
    return this;
  }

  get<T = unknown>(key: string): T {
    return this._settings.get(key) as T;
  }

  async teardown(): Promise<void> {
    // Adapters register teardown callbacks via app.get('teardown') if needed
  }
}
