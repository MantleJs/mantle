import { BatchScheduler } from "./batch-scheduler.js";
import { Emitter } from "./emitter.js";
import { errorFromResponse, MantleClientError } from "./errors.js";
import { serializeQuery } from "./serialize-query.js";
import { ServiceClient } from "./service-client.js";
import { SocketManager } from "./socket-manager.js";
import { defaultStorage } from "./storage.js";
import type {
  AuthCredentials,
  AuthResult,
  ClientEvent,
  ClientOptions,
  ClientParams,
  TokenStorage,
  UploadProgress,
} from "./types.js";

const ACCESS_TOKEN_KEY = "mantle-access-token";
const REFRESH_TOKEN_KEY = "mantle-refresh-token";

/** Create a Mantle client. Throws `TypeError` when `url` is missing. */
export function mantle(options: ClientOptions): MantleClient {
  return new MantleClient(options);
}

export class MantleClient {
  private readonly baseUrl: string;
  private readonly storage: TokenStorage;
  private readonly defaultHeaders: Record<string, string>;
  private readonly emitter = new Emitter<ClientEvent>();
  private readonly sockets?: SocketManager;
  private readonly scheduler?: BatchScheduler;
  private readonly services = new Map<string, ServiceClient<unknown>>();
  /** In-memory copy of the access token so `getAccessToken()` stays synchronous. */
  private accessToken?: string;
  private hydrated = false;
  /** Single-flight guard: concurrent 401s share one refresh — a second rotation
   * with the already-consumed token would trip the server's reuse detection. */
  private refreshing?: Promise<boolean>;

  constructor(options: ClientOptions) {
    if (typeof options?.url !== "string" || options.url.length === 0) {
      throw new TypeError("mantle() requires a 'url' option — the base URL of the Mantle server");
    }
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.storage = options.storage ?? defaultStorage();
    this.defaultHeaders = options.headers ?? {};
    if (options.socket) {
      this.sockets = new SocketManager(this.baseUrl, options.socket, () => this.emitter.emit("reconnect"));
    }
    if (options.batch) {
      const batchOptions = typeof options.batch === "object" ? options.batch : {};
      this.scheduler = new BatchScheduler(this, batchOptions, () => this.tryRefresh());
    }
  }

  service<T = unknown>(path: string): ServiceClient<T> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    let service = this.services.get(normalized);
    if (!service) {
      service = new ServiceClient<unknown>(normalized, this, this.sockets, this.scheduler);
      this.services.set(normalized, service);
    }
    return service as ServiceClient<T>;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const response = await this.send("POST", "authentication", credentials, undefined, false);
    if (!response.ok) throw await errorFromResponse(response);
    const result: unknown = await response.json();
    if (!hasAccessToken(result)) {
      throw new MantleClientError("Authentication response carried no accessToken", 500, "GeneralError", {
        hint: "The server answered 2xx without a token pair — check the authentication service's response shape.",
      });
    }
    await this.storeTokens(result);
    this.emitter.emit("authenticated");
    return result;
  }

  /**
   * Hydrate the client from a token pair obtained outside `authenticate()` — e.g. an OAuth
   * provider's redirect-back callback landing tokens in the URL fragment. Stores them and
   * emits `'authenticated'`, same as a successful `authenticate()` call.
   */
  async setTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
    if (!hasAccessToken(tokens)) throw new TypeError("setTokens() requires a non-empty 'accessToken'");
    await this.storeTokens(tokens);
    this.emitter.emit("authenticated");
  }

  async logout(): Promise<void> {
    const token = await this.loadAccessToken();
    // Fire-and-forget: servers without a logout endpoint just 404.
    void fetch(`${this.baseUrl}/authentication/logout`, {
      method: "POST",
      headers: token ? { ...this.defaultHeaders, authorization: `Bearer ${token}` } : this.defaultHeaders,
    }).catch(() => undefined);
    await this.clearTokens();
    this.emitter.emit("logout");
  }

  /** The server's base URL, trailing slashes removed — handy for building links to non-service routes. */
  get url(): string {
    return this.baseUrl;
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /**
   * Whether a persisted session exists, hydrating the in-memory access token from storage first
   * if nothing has triggered that yet. Use this on app startup instead of `getAccessToken()` —
   * that one is synchronous and returns `undefined` until hydration has happened (normally the
   * side effect of an authenticated REST call), even when a valid token is sitting in storage
   * from a previous session. A UI that checks `getAccessToken()` on first render will show its
   * logged-out state on every page load/refresh regardless of a persisted session.
   */
  async isAuthenticated(): Promise<boolean> {
    return (await this.loadAccessToken()) !== undefined;
  }

  on(event: ClientEvent, handler: () => void): this {
    this.emitter.on(event, handler);
    return this;
  }

  off(event: ClientEvent, handler: () => void): this {
    this.emitter.off(event, handler);
    return this;
  }

  /** REST dispatch used by every `ServiceClient` method: bearer auth, one refresh-retry on 401, typed errors. */
  async request<R>(method: string, path: string, data: unknown | undefined, params?: ClientParams): Promise<R> {
    const response = await this.send(method, path, data, params);
    if (response.ok) return this.parseBody<R>(response);
    const error = await errorFromResponse(response);
    if (response.status === 401 && (await this.tryRefresh())) {
      const retry = await this.send(method, path, data, params);
      if (retry.ok) return this.parseBody<R>(retry);
      throw await errorFromResponse(retry);
    }
    throw error;
  }

  /**
   * `multipart/form-data` dispatch used by `ServiceClient.upload()`: bearer auth, one refresh-retry
   * on 401, typed errors — the same guarantees as `request()`. The body is rebuilt for the retry,
   * since a consumed `FormData` stream can't be replayed by every transport.
   */
  async upload<R>(
    method: string,
    path: string,
    body: () => FormData,
    options: UploadTransportOptions = {},
  ): Promise<R> {
    const response = await this.sendForm(method, path, body(), options);
    if (response.ok) return this.parseBody<R>(response);
    const error = await errorFromResponse(response);
    if (response.status === 401 && (await this.tryRefresh())) {
      const retry = await this.sendForm(method, path, body(), options);
      if (retry.ok) return this.parseBody<R>(retry);
      throw await errorFromResponse(retry);
    }
    throw error;
  }

  private async sendForm(
    method: string,
    path: string,
    body: FormData,
    { headers: extra, onProgress, signal }: UploadTransportOptions,
  ): Promise<Response> {
    const url = `${this.baseUrl}/${path}`;
    // No content-type: the transport sets multipart/form-data with its own boundary.
    const headers: Record<string, string> = { ...this.defaultHeaders, ...extra };
    const token = await this.loadAccessToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
    const Xhr = xhrConstructor();
    if (onProgress && Xhr) {
      return xhrSend(Xhr, method, url, headers, body, onProgress, signal);
    }
    return fetch(url, { method, headers, body, signal });
  }

  private async send(
    method: string,
    path: string,
    data: unknown | undefined,
    params?: ClientParams,
    withAuth = true,
  ): Promise<Response> {
    let url = `${this.baseUrl}/${path}`;
    if (params?.query) {
      const query = serializeQuery(params.query);
      if (query) url += `?${query}`;
    }
    const headers: Record<string, string> = { ...this.defaultHeaders, ...params?.headers };
    if (data !== undefined) headers["content-type"] = "application/json";
    if (withAuth) {
      const token = await this.loadAccessToken();
      if (token) headers["authorization"] = `Bearer ${token}`;
    }
    return fetch(url, { method, headers, body: data !== undefined ? JSON.stringify(data) : undefined });
  }

  private async parseBody<R>(response: Response): Promise<R> {
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as R;
  }

  private tryRefresh(): Promise<boolean> {
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<boolean> {
    const refreshToken = await this.storage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;
    const response = await this.send("POST", "authentication", { strategy: "refresh", refreshToken }, undefined, false);
    // A 2xx without a usable token pair is a failed rotation too — storing it would leave
    // the client "authenticated" with no token.
    const pair: unknown = response.ok ? await response.json() : undefined;
    if (!hasAccessToken(pair)) {
      await this.clearTokens();
      this.emitter.emit("logout");
      return false;
    }
    await this.storeTokens(pair);
    return true;
  }

  private async loadAccessToken(): Promise<string | undefined> {
    if (!this.hydrated && this.accessToken === undefined) {
      this.accessToken = (await this.storage.getItem(ACCESS_TOKEN_KEY)) ?? undefined;
      this.hydrated = true;
    }
    return this.accessToken;
  }

  private async storeTokens(result: AuthResult): Promise<void> {
    this.accessToken = result.accessToken;
    this.hydrated = true;
    await this.storage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
    if (result.refreshToken) await this.storage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
  }

  private async clearTokens(): Promise<void> {
    this.accessToken = undefined;
    this.hydrated = true;
    await this.storage.removeItem(ACCESS_TOKEN_KEY);
    await this.storage.removeItem(REFRESH_TOKEN_KEY);
  }
}

/** Narrow an authentication response body to one that actually carries an access token. */
function hasAccessToken(value: unknown): value is AuthResult {
  if (value === null || typeof value !== "object") return false;
  const token = (value as Record<string, unknown>)["accessToken"];
  return typeof token === "string" && token.length > 0;
}

/** Transport-level upload options (`ServiceClient.upload()` resolves fields/filename into the body). */
export interface UploadTransportOptions {
  headers?: Record<string, string>;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/**
 * The slice of `XMLHttpRequest` the upload transport uses. This package compiles without the DOM lib
 * (it targets Node and React Native too), so the global is looked up structurally at runtime.
 */
interface XhrLike {
  status: number;
  statusText: string;
  responseText: string;
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  getResponseHeader(name: string): string | null;
  send(body: FormData): void;
  abort(): void;
}

type XhrConstructor = new () => XhrLike;

function xhrConstructor(): XhrConstructor | undefined {
  return (globalThis as { XMLHttpRequest?: XhrConstructor }).XMLHttpRequest;
}

/**
 * `XMLHttpRequest` transport for uploads that want progress events, adapted back to a `Response`
 * so success parsing and error mapping are shared with the `fetch` path.
 */
function xhrSend(
  Xhr: XhrConstructor,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: FormData,
  onProgress: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const xhr = new Xhr();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : undefined;
      onProgress({
        loaded: event.loaded,
        total,
        percent: total ? Math.round((event.loaded / total) * 100) : undefined,
      });
    };
    const onAbort = (): void => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = (): void => signal?.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      done();
      // 204/205/304 must be built without a body.
      const nullBody = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
      resolve(
        new Response(nullBody ? null : xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: { "content-type": xhr.getResponseHeader("content-type") ?? "application/json" },
        }),
      );
    };
    // Same rejection shapes as fetch: TypeError for network failure, the signal's reason on abort.
    xhr.onerror = () => {
      done();
      reject(new TypeError("Upload failed: network error"));
    };
    xhr.onabort = () => {
      done();
      reject(signal ? abortReason(signal) : new DOMException("The upload was aborted", "AbortError"));
    };
    xhr.send(body);
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The upload was aborted", "AbortError");
}
