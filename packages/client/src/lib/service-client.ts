import type { BatchScheduler } from "./batch-scheduler.js";
import { MantleClientError } from "./errors.js";
import type { SocketManager } from "./socket-manager.js";
import type {
  BatchCall,
  ClientParams,
  Id,
  Paginated,
  ServiceEvent,
  SimilarQuery,
  UploadOptions,
  UploadProgress,
} from "./types.js";

/** REST transport provided by `MantleClient` — auth, refresh-retry, and error handling live there. */
export interface RestDispatcher {
  request<R>(method: string, path: string, data: unknown | undefined, params?: ClientParams): Promise<R>;
  upload<R>(
    method: string,
    path: string,
    body: () => FormData,
    options?: {
      headers?: Record<string, string>;
      onProgress?: (progress: UploadProgress) => void;
      signal?: AbortSignal;
    },
  ): Promise<R>;
}

/**
 * Client-side counterpart of the server's `Service<T>` — the same six method
 * names, dispatched as REST calls, plus the `similar()` vector-search
 * convention and real-time `on()`/`off()` service events over socket.io.
 */
export class ServiceClient<T = unknown> {
  constructor(
    private readonly path: string,
    private readonly rest: RestDispatcher,
    private readonly sockets?: SocketManager,
    private readonly scheduler?: BatchScheduler,
  ) {}

  find(params?: ClientParams): Promise<T[] | Paginated<T>> {
    if (this.canBatch(params)) return this.batched("find", params) as Promise<T[] | Paginated<T>>;
    return this.rest.request("GET", this.path, undefined, params);
  }

  get(id: Id, params?: ClientParams): Promise<T> {
    if (this.canBatch(params)) return this.batched("get", params, id) as Promise<T>;
    return this.rest.request("GET", this.idPath(id), undefined, params);
  }

  create(data: Partial<T>, params?: ClientParams): Promise<T> {
    if (this.canBatch(params)) return this.batched("create", params, undefined, data) as Promise<T>;
    return this.rest.request("POST", this.path, data, params);
  }

  update(id: Id, data: Partial<T>, params?: ClientParams): Promise<T> {
    if (this.canBatch(params)) return this.batched("update", params, id, data) as Promise<T>;
    return this.rest.request("PUT", this.idPath(id), data, params);
  }

  patch(id: Id, data: Partial<T>, params?: ClientParams): Promise<T> {
    if (this.canBatch(params)) return this.batched("patch", params, id, data) as Promise<T>;
    return this.rest.request("PATCH", this.idPath(id), data, params);
  }

  remove(id: Id, params?: ClientParams): Promise<T> {
    if (this.canBatch(params)) return this.batched("remove", params, id) as Promise<T>;
    return this.rest.request("DELETE", this.idPath(id), undefined, params);
  }

  /** Per-request headers cannot ride along in a batch entry — those calls go out individually. */
  private canBatch(params?: ClientParams): boolean {
    return this.scheduler !== undefined && params?.headers === undefined;
  }

  private batched(method: BatchCall["method"], params?: ClientParams, id?: Id, data?: unknown): Promise<unknown> {
    const scheduler = this.scheduler as BatchScheduler;
    return scheduler.enqueue({
      service: this.path,
      method,
      ...(id !== undefined ? { id } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(params?.query ? { params: { query: params.query } } : {}),
    });
  }

  /**
   * Upload a file as `multipart/form-data` to a service whose `create` (or, with `options.id`,
   * `patch`) runs `@mantlejs/storage`'s `handleUpload()`. Ordinary `fields` go before the file part,
   * which `handleUpload()` merges into `context.data`. Never batched — `POST /batch` is JSON-only.
   */
  upload(file: Blob, options: UploadOptions = {}): Promise<T> {
    const { id, field = "file", fields, filename, onProgress, signal, headers } = options;
    const name = filename ?? (typeof File !== "undefined" && file instanceof File ? file.name : "blob");
    const body = (): FormData => {
      const form = new FormData();
      // Ordinary fields first: busboy streams parts in order.
      for (const [key, value] of Object.entries(fields ?? {})) form.append(key, value);
      form.append(field, file, name);
      return form;
    };
    const method = id === undefined ? "POST" : "PATCH";
    const path = id === undefined ? this.path : this.idPath(id);
    return this.rest.upload<T>(method, path, body, { headers, onProgress, signal });
  }

  /**
   * Vector-search convention (custom methods dispatch as POST /:service/:method).
   * The service must register `similar` in its `methods` — see `VectorRepositoryService`.
   */
  similar(data: SimilarQuery, params?: ClientParams): Promise<Array<T & { _score: number }>> {
    return this.rest.request("POST", `${this.path}/similar`, data, params);
  }

  /** True when the client was created with the `socket` option — `on()`/`off()` are available. */
  get realtime(): boolean {
    return this.sockets !== undefined;
  }

  on(event: ServiceEvent, handler: (data: T) => void): this {
    this.socketsOrThrow().on(this.eventName(event), handler as (data: unknown) => void);
    return this;
  }

  off(event: ServiceEvent, handler: (data: T) => void): this {
    this.socketsOrThrow().off(this.eventName(event), handler as (data: unknown) => void);
    return this;
  }

  private socketsOrThrow(): SocketManager {
    if (!this.sockets) {
      throw new MantleClientError(
        `Real-time events for service '${this.path}' require the client's 'socket' option to be configured`,
        500,
        "GeneralError",
      );
    }
    return this.sockets;
  }

  private eventName(event: ServiceEvent): string {
    return `${this.path} ${event}`;
  }

  private idPath(id: Id): string {
    return `${this.path}/${encodeURIComponent(String(id))}`;
  }
}
