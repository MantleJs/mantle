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

export interface ClientOptions {
  /** Base URL of the Mantle server, e.g. `"http://localhost:3030"`. Required. */
  url: string;
  /** Token storage. Default: `localStorage` when available, otherwise in-memory. */
  storage?: TokenStorage;
  /** Socket.io connection options. Omit to disable real-time features. */
  socket?: SocketOptions;
  /** Default headers appended to every REST request. */
  headers?: Record<string, string>;
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
