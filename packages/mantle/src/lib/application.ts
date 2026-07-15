import { EventEmitter } from "node:events";
import { BadRequest, GeneralError, MethodNotAllowed, NotFound } from "./errors.js";
import type {
  ChannelPublisher,
  HookConfig,
  HookContext,
  HookFunction,
  Id,
  Logger,
  MantleApplication,
  MantleChannel,
  MantleOptions,
  MantlePlugin,
  Paginated,
  RepositoryCapabilities,
  Service,
  ServiceDescriptor,
  ServiceHandle,
  ServiceOptions,
  ServiceParams,
} from "./types.js";

type ResolvedServiceOptions = {
  methods: string[];
  events: string[];
  schema?: unknown;
};

const DEFAULT_METHODS = ["find", "get", "create", "update", "patch", "remove"];
const DEFAULT_EVENTS = ["created", "updated", "patched", "removed"];

const SERVICE_EVENTS: Partial<Record<string, string>> = {
  create: "created",
  update: "updated",
  patch: "patched",
  remove: "removed",
};

async function runHookChain<T>(hooks: HookFunction<T>[], ctx: HookContext<T>): Promise<HookContext<T>> {
  let current = ctx;
  for (const hook of hooks) {
    current = await hook(current);
  }
  return current;
}

class ServiceHandleImpl<T> implements ServiceHandle<T> {
  private hookConfig: HookConfig<T> = {};
  private _publisher?: ChannelPublisher<unknown>;
  readonly schema: unknown;

  constructor(
    private readonly service: Partial<Service<T>>,
    private readonly path: string,
    private readonly app: MantleApplication,
    private readonly options: ResolvedServiceOptions,
  ) {
    this.schema = options.schema;
  }

  get methods(): string[] {
    return this.options.methods;
  }

  get publisher(): ChannelPublisher<unknown> | undefined {
    return this._publisher;
  }

  publish(publisher: ChannelPublisher<T>): this {
    this._publisher = publisher as ChannelPublisher<unknown>;
    return this;
  }

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

    switch (ctx.method) {
      case "find": {
        const fn = this.service.find;
        if (typeof fn !== "function") throw new MethodNotAllowed(`Method 'find' is not implemented on service '${ctx.path}'`);
        return (fn as Service<T>["find"]).call(this.service, ctx.params);
      }
      case "create": {
        const fn = this.service.create;
        if (typeof fn !== "function") throw new MethodNotAllowed(`Method 'create' is not implemented on service '${ctx.path}'`);
        return (fn as Service<T>["create"]).call(this.service, ctx.data as Partial<T>, ctx.params);
      }
      case "get": {
        const fn = this.service.get;
        if (typeof fn !== "function") throw new MethodNotAllowed(`Method 'get' is not implemented on service '${ctx.path}'`);
        if (ctx.id === undefined) throw new BadRequest("'id' is required for get");
        return (fn as Service<T>["get"]).call(this.service, ctx.id, ctx.params);
      }
      case "update": {
        const fn = this.service.update;
        if (typeof fn !== "function") throw new MethodNotAllowed(`Method 'update' is not implemented on service '${ctx.path}'`);
        if (ctx.id === undefined) throw new BadRequest("'id' is required for update");
        return (fn as Service<T>["update"]).call(this.service, ctx.id, ctx.data as Partial<T>, ctx.params);
      }
      case "patch": {
        const fn = this.service.patch;
        if (typeof fn !== "function") throw new MethodNotAllowed(`Method 'patch' is not implemented on service '${ctx.path}'`);
        if (ctx.id === undefined) throw new BadRequest("'id' is required for patch");
        return (fn as Service<T>["patch"]).call(this.service, ctx.id, ctx.data as Partial<T>, ctx.params);
      }
      case "remove": {
        const fn = this.service.remove;
        if (typeof fn !== "function") throw new MethodNotAllowed(`Method 'remove' is not implemented on service '${ctx.path}'`);
        if (ctx.id === undefined) throw new BadRequest("'id' is required for remove");
        return (fn as Service<T>["remove"]).call(this.service, ctx.id, ctx.params);
      }
      default: {
        const customFn = (this.service as Record<string, unknown>)[ctx.method];
        if (typeof customFn === "function") {
          return (customFn as (data: Partial<T>, params: ServiceParams) => Promise<T | T[] | Paginated<T>>).call(
            this.service,
            ctx.data as Partial<T>,
            ctx.params,
          );
        }
        throw new MethodNotAllowed(`Method '${ctx.method}' is not a standard service method`);
      }
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

      const serviceEventName = SERVICE_EVENTS[method] ?? (this.options.events.includes(method) ? method : undefined);
      if (serviceEventName) {
        this.app.emit("service:event", this.path, serviceEventName, ctx.result, ctx.params);
      }

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

  async dispatch(method: string, data?: Partial<T>, id?: Id, params?: ServiceParams): Promise<T | T[] | Paginated<T>> {
    return this.runPipeline(method, params, id, data);
  }

  describe(): ServiceDescriptor {
    const standardEvents = this.options.methods
      .map((method) => SERVICE_EVENTS[method])
      .filter((event): event is string => event !== undefined);
    const customEvents = this.options.events.filter((event) => !DEFAULT_EVENTS.includes(event));

    const service = this.service as { describe?: () => RepositoryCapabilities | undefined };
    const capabilities = typeof service.describe === "function" ? service.describe() : undefined;

    // Auth hooks (e.g. @mantlejs/auth authenticate()) mark themselves with an `authStrategy` property.
    const authRequired = (this.hookConfig.before?.all ?? []).some(
      (hook) => typeof (hook as { authStrategy?: unknown }).authStrategy === "string",
    );

    return {
      path: this.path,
      methods: [...this.options.methods],
      events: [...standardEvents, ...customEvents],
      ...(this.schema !== undefined ? { schema: this.schema } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
      authRequired,
    };
  }
}

export class MantleApplicationImpl implements MantleApplication {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _services = new Map<string, ServiceHandleImpl<any>>();
  private readonly _settings = new Map<string, unknown>();
  private readonly _emitter = new EventEmitter();

  constructor(private readonly _options: MantleOptions = {}) {
    void this._options;
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    this._emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    this._emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    this._emitter.emit(event, ...args);
  }

  channel(name: string | string[]): MantleChannel {
    const factory = this.get<((name: string | string[]) => MantleChannel) | undefined>("__channelFactory");
    if (!factory) throw new GeneralError("Channels are not configured — use app.configure(socketio()) first");
    return factory(name);
  }

  publish<T = unknown>(publisher: ChannelPublisher<T>): this {
    this._settings.set("__globalPublisher", publisher as ChannelPublisher<unknown>);
    return this;
  }

  use<T = unknown>(path: string, service: Partial<Service<T>>, options: ServiceOptions = {}): this {
    const key = path.replace(/^\//, "");
    const handle = new ServiceHandleImpl<T>(service, key, this, {
      methods: options.methods ?? DEFAULT_METHODS,
      events: options.events ?? DEFAULT_EVENTS,
      schema: options.schema,
    });
    this._services.set(key, handle);
    this.get<Logger | undefined>("logger")?.debug("Service registered", { component: "mantle:core", path: key });
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
    this.get<Logger | undefined>("logger")?.info("Application teardown", { component: "mantle:core" });
  }
}
