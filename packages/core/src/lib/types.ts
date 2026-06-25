export type Id = string | number;

export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}

export interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

export interface ServiceParams {
  query?: Record<string, unknown>;
  user?: Record<string, unknown>;
  provider?: string;
  headers?: Record<string, string>;
  /** Per-socket connection state. Set by the socket.io transport and persists across calls from the same socket. */
  connection?: Record<string, unknown>;
  /** Rooms to broadcast mutation events to. If set by a before hook, the socket.io transport will broadcast only to these rooms instead of all clients. */
  rooms?: string | string[];
  [key: string]: unknown;
}

export interface QueryParams {
  where?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort?: Record<string, "asc" | "desc">;
  select?: string[];
}

export interface Service<T, D = Partial<T>> {
  find(params?: ServiceParams): Promise<T[] | Paginated<T>>;
  get(id: Id, params?: ServiceParams): Promise<T>;
  create(data: D, params?: ServiceParams): Promise<T>;
  update(id: Id, data: D, params?: ServiceParams): Promise<T>;
  patch(id: Id, data: D, params?: ServiceParams): Promise<T>;
  remove(id: Id, params?: ServiceParams): Promise<T>;
}

export interface Repository<T, D = Partial<T>> {
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: D): Promise<T>;
  saveAll(data: D[]): Promise<T[]>;
  updateById(id: Id, data: D): Promise<T>;
  patchById(id: Id, data: D): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;
}

export interface HookContext<T = unknown> {
  app: MantleApplication;
  service: Partial<Service<T>>;
  path: string;
  method: string;
  provider?: string;
  params: ServiceParams;
  data?: Partial<T>;
  id?: Id;
  result?: T | T[] | Paginated<T>;
  error?: Error;
  statusCode?: number;
}

export type HookFunction<T = unknown> = (context: HookContext<T>) => Promise<HookContext<T>> | HookContext<T>;

export type MethodHookMap<T> = {
  [method in keyof Service<T> | "all"]?: HookFunction<T>[];
};

export interface HookConfig<T = unknown> {
  before?: MethodHookMap<T>;
  after?: MethodHookMap<T>;
  error?: MethodHookMap<T>;
}

export interface ServiceOptions {
  methods?: string[];
  events?: string[];
  /** TypeBox schema for this service. Stored for tooling introspection — not validated here. */
  schema?: unknown;
}

export interface MantleOptions {
  errorHandler?: boolean;
}

export type MantlePlugin = (app: MantleApplication) => void | Promise<void>;

export interface ServiceHandle<T> extends Service<T> {
  hooks(config: HookConfig<T>): this;
  dispatch(method: string, data?: Partial<T>, id?: Id, params?: ServiceParams): Promise<T | T[] | Paginated<T>>;
  readonly schema?: unknown;
  readonly methods: string[];
}

export interface MantleApplication {
  use<T = unknown>(path: string, service: Partial<Service<T>>, options?: ServiceOptions): this;
  service<T = unknown>(path: string): ServiceHandle<T>;
  configure(plugin: MantlePlugin): this;
  set(key: string, value: unknown): this;
  get<T = unknown>(key: string): T;
  teardown(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): void;
}
