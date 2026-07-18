import { Emitter } from "./emitter.js";
import { errorFromResponse } from "./errors.js";
import { serializeQuery } from "./serialize-query.js";
import { ServiceClient } from "./service-client.js";
import { SocketManager } from "./socket-manager.js";
import { defaultStorage } from "./storage.js";
import type { AuthCredentials, AuthResult, ClientEvent, ClientOptions, ClientParams, TokenStorage } from "./types.js";

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
  }

  service<T = unknown>(path: string): ServiceClient<T> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    let service = this.services.get(normalized);
    if (!service) {
      service = new ServiceClient<unknown>(normalized, this, this.sockets);
      this.services.set(normalized, service);
    }
    return service as ServiceClient<T>;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const response = await this.send("POST", "authentication", credentials, undefined, false);
    if (!response.ok) throw await errorFromResponse(response);
    const result = (await response.json()) as AuthResult;
    await this.storeTokens(result);
    this.emitter.emit("authenticated");
    return result;
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

  getAccessToken(): string | undefined {
    return this.accessToken;
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
    if (!response.ok) {
      await this.clearTokens();
      this.emitter.emit("logout");
      return false;
    }
    const pair = (await response.json()) as AuthResult;
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
