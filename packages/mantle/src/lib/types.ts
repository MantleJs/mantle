export type Id = string | number;

export interface MantleChannel {
  readonly connections: Record<string, unknown>[];
  join(connection: Record<string, unknown>): this;
  leave(connection: Record<string, unknown>): this;
  filter(fn: (data: unknown, connection: Record<string, unknown>) => boolean): MantleChannel;
}

export interface PublishContext {
  app: MantleApplication;
  path: string;
  params: ServiceParams;
}

export type ChannelPublisher<T = unknown> = (
  data: T | T[] | Paginated<T>,
  context: PublishContext,
) => MantleChannel | MantleChannel[] | null | undefined | void;

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
  /** True on `service:event` emissions that did NOT pass through the hook pipeline — e.g. Supabase change-feed re-emissions of direct DB mutations. */
  external?: boolean;
  [key: string]: unknown;
}

export interface QueryParams {
  /**
   * Filter clause. Keys are field names — adapters backed by nested documents
   * (memory, supabase, mongodb) also accept dot-path keys like `"metadata.tags"`.
   * Values are literals (equality), `null` (IS NULL), or operator objects:
   * `$lt`/`$lte`/`$gt`/`$gte`, `$ne`, `$in`/`$nin`, `$like`/`$notlike`/`$ilike`,
   * `$contains` (array/JSON containment, jsonb `@>` semantics), plus top-level
   * `$or`/`$and`. Each adapter enforces its supported subset via
   * `assertOperators` — see `describe().operators`.
   */
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

/**
 * Machine-readable description of what a repository adapter can do. Returned by
 * `Repository.describe()` so tooling (OpenAPI generation, `/_services` introspection,
 * agents) can discover adapter capabilities without trial-and-error queries.
 */
export interface RepositoryCapabilities {
  /** Package name of the adapter, e.g. "@mantlejs/knex". */
  adapter: string;
  /** Exactly the `$`-operators the adapter's where-clause translator accepts — the same set its `assertOperators` call enforces. */
  operators: string[];
  /** Pagination styles the adapter supports through `QueryParams`. */
  pagination: "offset" | "cursor" | "both";
  /** Whether the adapter exposes native full-text search. */
  fullTextSearch: boolean;
  /** When present, returns true if the given where clause forces a full scan (e.g. DynamoDB Scan instead of Query). */
  scanning?: (where: Record<string, unknown>) => boolean;
}

/**
 * One page of a cursor-paginated result set, returned by `Repository.findPage()`.
 * `cursor` is an opaque adapter-specific token; pass it back as `params.cursor`
 * to fetch the next page. Absent when there are no further pages.
 */
export interface CursorPage<T> {
  data: T[];
  cursor?: string;
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
  /**
   * Optional cursor pagination. Implemented by adapters whose backend is natively cursored
   * (DynamoDB, Qdrant, Pinecone) — `describe().pagination` reports `"cursor"` or `"both"` when
   * available. Stateless: the cursor lives entirely in the returned page, so concurrent calls
   * on one repository instance never interfere.
   */
  findPage?(params?: QueryParams & { cursor?: string }): Promise<CursorPage<T>>;
  /** Optional capability introspection. All @mantlejs adapters implement it; user repositories may omit it. */
  describe?(): RepositoryCapabilities;
}

export interface VectorRepository<T extends Record<string, unknown>, D = Partial<T>> extends Repository<T, D> {
  /**
   * Find the top-K records most similar to the given embedding vector.
   * Every result carries the adapter's native match metric as `_score` — whether a higher
   * or lower value means "more similar" is adapter-specific; see the adapter README.
   */
  findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<Array<T & { _score: number }>>;
  /** Upsert a record with its embedding vector */
  upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T>;
  /** Delete a vector and its associated record */
  deleteVector(id: Id): Promise<T>;
}

export interface GraphRepository<T extends Record<string, unknown>> {
  /** Create a node */
  createNode(data: Partial<T>): Promise<T>;
  /** Find a node by ID */
  findNodeById(id: Id): Promise<T | null>;
  /** Find nodes matching properties */
  findNodes(params?: QueryParams): Promise<T[]>;
  /** Create a directed relationship between two nodes */
  createRelationship(fromId: Id, toId: Id, type: string, properties?: Record<string, unknown>): Promise<void>;
  /** Traverse relationships from a starting node */
  traverse(startId: Id, relation: string, depth?: number): Promise<T[]>;
  /** Delete a node and all its relationships */
  deleteNode(id: Id): Promise<T>;
  /** Execute a raw query in the adapter's native graph language (Cypher for Neo4j, AQL for ArangoDB, …). */
  raw<R = T>(query: string, params?: Record<string, unknown>): Promise<R[]>;
  /** Optional capability introspection. All @mantlejs adapters implement it; user repositories may omit it. */
  describe?(): RepositoryCapabilities;
}

/** Minimal express-compatible request passed to `HttpRouterLike` handlers. */
export interface HttpRequestLike {
  protocol: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  get(header: string): string | undefined;
}

/** Minimal express-compatible response passed to `HttpRouterLike` handlers. */
export interface HttpResponseLike {
  status(code: number): this;
  json(body: unknown): void;
  redirect(url: string): void;
  /**
   * Send a raw pre-serialized string body (e.g. an HTML page). Strings starting with "<"
   * are served as text/html, otherwise text/plain — mirroring Express's `res.send()`.
   * Optional: Express provides it natively; the koa/http adapters implement it.
   */
  send?(body: string): void;
}

export type HttpRouteHandler = (
  req: HttpRequestLike,
  res: HttpResponseLike,
  next: (err?: unknown) => void,
) => void | Promise<void>;

/**
 * Transport-neutral router contract. Every HTTP transport registers an implementation
 * under `app.set("http:router", …)` so plugins can mount raw routes (e.g. OAuth redirects)
 * without knowing which transport is in play. Transports also set `app.set("http:server", server)`
 * and `app.emit("http:server", server)` when `listen()` creates the underlying Node server.
 */
export interface HttpRouterLike {
  get(path: string, handler: HttpRouteHandler): void;
  post(path: string, handler: HttpRouteHandler): void;
}

/**
 * Normalized CORS option shape shared by `@mantlejs/express`, `@mantlejs/koa`, and `@mantlejs/http` so
 * switching transports doesn't require relearning CORS configuration. Each transport translates this
 * into its own mechanism — the `cors` package, `@koa/cors`, or hand-rolled headers for `@mantlejs/http`.
 */
export interface CorsOptions {
  /** Allowed origin(s) for `Access-Control-Allow-Origin`. `true` reflects the request's `Origin` header. Default: `true`. */
  origin?: boolean | string | string[] | ((requestOrigin: string | undefined) => boolean | string);
  /** Allowed methods for `Access-Control-Allow-Methods`. Default: `["GET", "POST", "PUT", "PATCH", "DELETE"]`. */
  methods?: string[];
  /** Allowed request headers for `Access-Control-Allow-Headers`. Default: reflects `Access-Control-Request-Headers`. */
  allowedHeaders?: string[];
  /** Headers exposed to the browser via `Access-Control-Expose-Headers`. */
  exposedHeaders?: string[];
  /** Allow credentials (cookies, `Authorization` header) cross-origin. Default: `false`. */
  credentials?: boolean;
  /** How long, in seconds, browsers may cache a preflight response (`Access-Control-Max-Age`). */
  maxAge?: number;
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
  /**
   * Custom method names that emit a `service:event` when dispatched — the event name is the
   * method name. Standard mutation events (created/updated/patched/removed) always emit.
   */
  events?: string[];
  /** TypeBox schema for this service. Stored for tooling introspection — not validated here. */
  schema?: unknown;
}

/** Default maximum number of calls per batch request. Transports can override via their `batch` option. */
export const DEFAULT_MAX_BATCH_SIZE = 25;

/** One call in a batch, dispatched by `app.batch()` through the full hook pipeline of the target service. */
export interface BatchCall {
  /** Registered service path, e.g. `"users"`. */
  service: string;
  method: "find" | "get" | "create" | "update" | "patch" | "remove";
  id?: Id;
  data?: unknown;
  /** Per-call params. `query` uses the same shape as a parsed REST query string (`$limit`, `$sort`, where fields…). */
  params?: { query?: Record<string, unknown> };
}

/** Outcome of one `BatchCall`. Returned by `app.batch()` in the same order as the input array. */
export interface BatchResult {
  status: "success" | "error";
  result?: unknown;
  /** `MantleError.toJSON()` shape — at minimum `name`, `message`, `code`. */
  error?: { name: string; message: string; code: number; [key: string]: unknown };
}

export interface BatchDispatchOptions {
  /** Maximum calls per batch. Requests exceeding it are rejected with `BadRequest` before any call executes. @default 25 */
  maxSize?: number;
}

export interface MantleOptions {
  errorHandler?: boolean;
}

export type MantlePlugin = (app: MantleApplication) => void | Promise<void>;

/**
 * Machine-readable description of a registered service, returned by `ServiceHandle.describe()`
 * and served by the transports' opt-in `GET /_services` introspection endpoint.
 */
export interface ServiceDescriptor {
  path: string;
  methods: string[];
  /** Event names this service emits: the standard created/updated/patched/removed set filtered by registered methods, plus custom `ServiceOptions.events`. */
  events: string[];
  /** The `ServiceOptions.schema` stored at registration (JSON Schema, e.g. via TypeBox). */
  schema?: unknown;
  /** The underlying repository's capabilities, when the service exposes them (see `RepositoryService.describe()`). */
  capabilities?: RepositoryCapabilities;
  /** True when an auth hook (a hook carrying an `authStrategy` property, e.g. `authenticate("jwt")`) is registered in `before.all`. */
  authRequired?: boolean;
}

export interface ServiceHandle<T> extends Service<T> {
  hooks(config: HookConfig<T>): this;
  dispatch(method: string, data?: Partial<T>, id?: Id, params?: ServiceParams): Promise<T | T[] | Paginated<T>>;
  describe(): ServiceDescriptor;
  readonly schema?: unknown;
  readonly methods: string[];
  publish(publisher: ChannelPublisher<T>): this;
  readonly publisher?: ChannelPublisher<unknown>;
}

export interface MantleApplication {
  use<T = unknown>(path: string, service: Partial<Service<T>>, options?: ServiceOptions): this;
  service<T = unknown>(path: string): ServiceHandle<T>;
  /**
   * Dispatch many service calls concurrently (`Promise.allSettled` semantics) and return one
   * `BatchResult` per call, in input order. Each call runs the target service's full hook
   * pipeline — batch is not a way to bypass authentication or validation. `params` (headers,
   * user, provider — typically the outer HTTP request's) is inherited by every call and merged
   * with the call's own `params.query`. One call failing does not fail the batch; there is no
   * cross-call atomicity.
   */
  batch(calls: BatchCall[], params?: ServiceParams, options?: BatchDispatchOptions): Promise<BatchResult[]>;
  configure(plugin: MantlePlugin): this;
  set(key: string, value: unknown): this;
  get<T = unknown>(key: string): T;
  teardown(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): void;
  channel(name: string | string[]): MantleChannel;
  publish<T = unknown>(publisher: ChannelPublisher<T>): this;
}
