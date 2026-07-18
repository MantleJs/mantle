export type Id = string | number;

/**
 * Pluggable token persistence. Sync-or-async so `localStorage` (browser),
 * a plain in-memory Map (Node.js), and async stores (React Native
 * AsyncStorage) all satisfy the interface without wrappers.
 */
export interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/**
 * A connected socket.io-client socket, typed structurally so the client has no
 * hard dependency on `socket.io-client`.
 */
export interface SocketLike {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  off(event: string, handler: (...args: unknown[]) => void): unknown;
}

export type SocketFactory = (url: string, options: Record<string, unknown>) => SocketLike;

/**
 * socket.io-client connection options, passed through to `io(url, options)`.
 * `io` overrides the socket factory itself — inject a stub in tests, or supply
 * a pre-bundled `io` when dynamic import of the optional peer is undesirable.
 */
export interface SocketOptions extends Record<string, unknown> {
  io?: SocketFactory;
}

/** One call in a coalesced `POST /batch` request — mirrors the server's `BatchCall`. */
export interface BatchCall {
  service: string;
  method: "find" | "get" | "create" | "update" | "patch" | "remove";
  id?: Id;
  data?: unknown;
  params?: { query?: Record<string, unknown> };
}

/** Outcome of one `BatchCall`, as returned by the server's batch endpoint. */
export interface BatchResult {
  status: "success" | "error";
  result?: unknown;
  error?: { name?: string; message?: string; code?: number };
}

export interface BatchOptions {
  /** Coalescing window in milliseconds. `0` (default) flushes on the next microtask tick. */
  windowMs?: number;
  /** Maximum calls per `POST /batch` — longer queues split into multiple requests. Match the server's max batch size. @default 25 */
  maxSize?: number;
}

export interface ClientOptions {
  /** Base URL of the Mantle server, e.g. `"http://localhost:3030"`. Required. */
  url: string;
  /** Token storage. Default: `localStorage` when available, otherwise in-memory. */
  storage?: TokenStorage;
  /** Socket.io connection options. Omit to disable real-time features. */
  socket?: SocketOptions;
  /** Default headers appended to every REST request. */
  headers?: Record<string, string>;
  /**
   * Coalesce service calls made within the same window into one `POST /batch`
   * request (the server's batch endpoint must be enabled — it is by default).
   * Calls carrying per-request `headers` bypass coalescing. @default false
   */
  batch?: boolean | BatchOptions;
}

export interface ClientParams {
  /** Query parameters serialized into the URL for find/get. */
  query?: Record<string, unknown>;
  /** Per-request header overrides. */
  headers?: Record<string, string>;
}

export interface AuthCredentials {
  strategy: string;
  [key: string]: unknown;
}

export interface AuthResult {
  accessToken: string;
  refreshToken?: string;
  user?: unknown;
}

export interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

export type ServiceEvent = "created" | "updated" | "patched" | "removed";

export type ClientEvent = "authenticated" | "logout" | "reconnect";

/** Payload for the `similar()` vector-search convention (see the mantle README). */
export interface SimilarQuery {
  vector: number[];
  topK?: number;
  where?: Record<string, unknown>;
  [key: string]: unknown;
}
