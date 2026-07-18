import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { mantle, MantleClient } from "./client.js";
import { MantleClientError } from "./errors.js";
import { memoryStorage } from "./storage.js";
import type { SocketLike, TokenStorage } from "./types.js";

const BASE = "http://api.test";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

describe("mantle()", () => {
  it("throws TypeError when url is missing", () => {
    expect(() => mantle({} as never)).toThrow(TypeError);
  });

  it("returns a MantleClient and caches service clients per normalized path", () => {
    const client = mantle({ url: BASE, storage: memoryStorage() });
    expect(client).toBeInstanceOf(MantleClient);
    expect(client.service("messages")).toBe(client.service("/messages/"));
    expect(client.service("messages")).not.toBe(client.service("users"));
  });
});

describe("ServiceClient REST mapping", () => {
  let client: MantleClient;

  beforeEach(() => {
    client = mantle({ url: `${BASE}/`, storage: memoryStorage() });
  });

  it("find() issues GET /:service with a serialized query", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 0, limit: 10, skip: 0, data: [] }));
    const result = await client.service("messages").find({ query: { age: { $gt: 21 }, $limit: 10 } });
    const { url, init } = lastRequest();
    expect(init.method).toBe("GET");
    expect(decodeURIComponent(url)).toBe(`${BASE}/messages?age[$gt]=21&$limit=10`);
    expect(result).toEqual({ total: 0, limit: 10, skip: 0, data: [] });
  });

  it("get() issues GET /:service/:id with the id URI-encoded", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "a/b" }));
    await client.service("messages").get("a/b");
    expect(lastRequest().url).toBe(`${BASE}/messages/a%2Fb`);
    expect(lastRequest().init.method).toBe("GET");
  });

  it("create() issues POST with a JSON body and content-type header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, text: "hi" }, 201));
    const result = await client.service("messages").create({ text: "hi" });
    const { url, init } = lastRequest();
    expect(url).toBe(`${BASE}/messages`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ text: "hi" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(result).toEqual({ id: 1, text: "hi" });
  });

  it("update(), patch(), remove() map to PUT, PATCH, DELETE", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    await client.service("messages").update(1, { text: "a" });
    expect(lastRequest().init.method).toBe("PUT");
    await client.service("messages").patch(1, { text: "b" });
    expect(lastRequest().init.method).toBe("PATCH");
    await client.service("messages").remove(1);
    expect(lastRequest().init.method).toBe("DELETE");
    expect(lastRequest().url).toBe(`${BASE}/messages/1`);
  });

  it("similar() dispatches as POST /:service/similar (custom-method convention)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1, _score: 0.9 }]));
    const result = await client.service("docs").similar({ vector: [0.1, 0.2], topK: 5 });
    const { url, init } = lastRequest();
    expect(url).toBe(`${BASE}/docs/similar`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ vector: [0.1, 0.2], topK: 5 }));
    expect(result).toEqual([{ id: 1, _score: 0.9 }]);
  });

  it("merges default headers with per-request headers, per-request winning", async () => {
    const withHeaders = mantle({ url: BASE, storage: memoryStorage(), headers: { "x-app": "one", "x-keep": "yes" } });
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await withHeaders.service("messages").find({ headers: { "x-app": "two" } });
    const headers = lastRequest().init.headers as Record<string, string>;
    expect(headers["x-app"]).toBe("two");
    expect(headers["x-keep"]).toBe("yes");
  });
});

describe("error deserialization", () => {
  it("throws a MantleClientError built from the Mantle error JSON, including hint", async () => {
    const client = mantle({ url: BASE, storage: memoryStorage() });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          name: "BadRequest",
          message: "Operator $bad is not supported",
          code: 400,
          className: "bad-request",
          data: { field: "x" },
          errors: [],
          hint: "Use one of: $gt, $lt",
        },
        400,
      ),
    );
    const error = await client
      .service("messages")
      .find()
      .catch((e: unknown) => e as MantleClientError);
    expect(error).toBeInstanceOf(MantleClientError);
    expect(error).toMatchObject({
      name: "BadRequest",
      code: 400,
      className: "bad-request",
      message: "Operator $bad is not supported",
      hint: "Use one of: $gt, $lt",
      data: { field: "x" },
    });
  });

  it("falls back to the HTTP status when the body is not JSON (gateway errors)", async () => {
    const client = mantle({ url: BASE, storage: memoryStorage() });
    fetchMock.mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    const error = await client
      .service("messages")
      .find()
      .catch((e: unknown) => e as MantleClientError);
    expect(error).toBeInstanceOf(MantleClientError);
    expect(error.code).toBe(502);
    expect(error.message).toBe("Bad Gateway");
  });

  it("maps bare 404s to the NotFound name", async () => {
    const client = mantle({ url: BASE, storage: memoryStorage() });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404, statusText: "Not Found" }));
    const error = await client
      .service("messages")
      .get(9)
      .catch((e: unknown) => e as MantleClientError);
    expect(error.name).toBe("NotFound");
  });

  it("propagates network failures unwrapped", async () => {
    const client = mantle({ url: BASE, storage: memoryStorage() });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(client.service("messages").find()).rejects.toThrow(TypeError);
  });
});

describe("authentication", () => {
  let client: MantleClient;
  let storage: TokenStorage;

  beforeEach(() => {
    storage = memoryStorage();
    client = mantle({ url: BASE, storage });
  });

  it("authenticate() POSTs /authentication, stores tokens, emits 'authenticated'", async () => {
    const authenticated = vi.fn();
    client.on("authenticated", authenticated);
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: "at-1", refreshToken: "rt-1", user: { id: 1 } }, 201));
    const result = await client.authenticate({ strategy: "local", email: "a@b.c", password: "pw" });
    const { url, init } = lastRequest();
    expect(url).toBe(`${BASE}/authentication`);
    expect(init.body).toBe(JSON.stringify({ strategy: "local", email: "a@b.c", password: "pw" }));
    expect((init.headers as Record<string, string>)["authorization"]).toBeUndefined();
    expect(result.user).toEqual({ id: 1 });
    expect(client.getAccessToken()).toBe("at-1");
    expect(await storage.getItem("mantle-access-token")).toBe("at-1");
    expect(await storage.getItem("mantle-refresh-token")).toBe("rt-1");
    expect(authenticated).toHaveBeenCalledTimes(1);
  });

  it("authenticate() failure throws and stores nothing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: "NotAuthenticated", message: "nope", code: 401 }, 401));
    await expect(client.authenticate({ strategy: "local" })).rejects.toMatchObject({ code: 401 });
    expect(client.getAccessToken()).toBeUndefined();
    expect(await storage.getItem("mantle-access-token")).toBeNull();
  });

  it("attaches Authorization: Bearer to requests after authenticating", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: "at-1", refreshToken: "rt-1", user: {} }, 201));
    await client.authenticate({ strategy: "local" });
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await client.service("messages").find();
    expect((lastRequest().init.headers as Record<string, string>)["authorization"]).toBe("Bearer at-1");
  });

  it("hydrates the access token from (async) storage for a fresh client", async () => {
    await storage.setItem("mantle-access-token", "persisted");
    const asyncStorage: TokenStorage = {
      getItem: (key) => Promise.resolve(storage.getItem(key) as string | null),
      setItem: (key, value) => Promise.resolve(storage.setItem(key, value) as void),
      removeItem: (key) => Promise.resolve(storage.removeItem(key) as void),
    };
    const fresh = mantle({ url: BASE, storage: asyncStorage });
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await fresh.service("messages").find();
    expect((lastRequest().init.headers as Record<string, string>)["authorization"]).toBe("Bearer persisted");
    expect(fresh.getAccessToken()).toBe("persisted");
  });

  it("logout() clears tokens, emits 'logout', and fires a best-effort server call", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: "at-1", refreshToken: "rt-1", user: {} }, 201));
    await client.authenticate({ strategy: "local" });
    const logout = vi.fn();
    client.on("logout", logout);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await client.logout();
    expect(lastRequest().url).toBe(`${BASE}/authentication/logout`);
    expect(client.getAccessToken()).toBeUndefined();
    expect(await storage.getItem("mantle-access-token")).toBeNull();
    expect(await storage.getItem("mantle-refresh-token")).toBeNull();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("401 refresh-and-retry", () => {
  let client: MantleClient;
  let storage: TokenStorage;

  beforeEach(async () => {
    storage = memoryStorage();
    client = mantle({ url: BASE, storage });
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: "at-1", refreshToken: "rt-1", user: {} }, 201));
    await client.authenticate({ strategy: "local" });
    fetchMock.mockClear();
  });

  it("on 401, rotates via POST /authentication { strategy: 'refresh' } and retries once", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: "NotAuthenticated", message: "expired", code: 401 }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "at-2", refreshToken: "rt-2" }, 201))
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }]));

    const result = await client.service("messages").find();
    expect(result).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const refreshCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshCall[0]).toBe(`${BASE}/authentication`);
    expect(refreshCall[1].body).toBe(JSON.stringify({ strategy: "refresh", refreshToken: "rt-1" }));

    const retryCall = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryCall[1].headers as Record<string, string>)["authorization"]).toBe("Bearer at-2");
    expect(await storage.getItem("mantle-refresh-token")).toBe("rt-2");
  });

  it("on refresh failure, clears tokens, emits 'logout', and throws the original 401", async () => {
    const logout = vi.fn();
    client.on("logout", logout);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: "NotAuthenticated", message: "expired", code: 401 }, 401))
      .mockResolvedValueOnce(jsonResponse({ name: "NotAuthenticated", message: "reuse detected", code: 401 }, 401));

    const error = await client
      .service("messages")
      .find()
      .catch((e: unknown) => e as MantleClientError);
    expect(error).toMatchObject({ name: "NotAuthenticated", code: 401, message: "expired" });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken()).toBeUndefined();
    expect(await storage.getItem("mantle-refresh-token")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not attempt refresh without a stored refresh token", async () => {
    await storage.removeItem("mantle-refresh-token");
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: "NotAuthenticated", message: "expired", code: 401 }, 401));
    await expect(client.service("messages").find()).rejects.toMatchObject({ code: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a second time when the retried request 401s again", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: "NotAuthenticated", message: "expired", code: 401 }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "at-2", refreshToken: "rt-2" }, 201))
      .mockResolvedValueOnce(jsonResponse({ name: "NotAuthenticated", message: "still no", code: 401 }, 401));
    await expect(client.service("messages").find()).rejects.toMatchObject({ message: "still no" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("single-flights concurrent refreshes — rotation makes a second refresh a theft signal", async () => {
    let refreshCount = 0;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url === `${BASE}/authentication`) {
        refreshCount++;
        return Promise.resolve(jsonResponse({ accessToken: "at-2", refreshToken: "rt-2" }, 201));
      }
      const auth = (init.headers as Record<string, string>)["authorization"];
      return Promise.resolve(
        auth === "Bearer at-2"
          ? jsonResponse([])
          : jsonResponse({ name: "NotAuthenticated", message: "expired", code: 401 }, 401),
      );
    });

    await Promise.all([client.service("messages").find(), client.service("users").find()]);
    expect(refreshCount).toBe(1);
  });
});

// ─── Real-time (C-8 fold-in: reconnect event) ────────────────────────────────

interface FakeSocket extends SocketLike {
  listeners: Map<string, Array<(...args: unknown[]) => void>>;
  trigger(event: string, data?: unknown): void;
}

function fakeSocket(): FakeSocket {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    listeners,
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    off(event, handler) {
      const list = listeners.get(event) ?? [];
      listeners.set(
        event,
        list.filter((h) => h !== handler),
      );
    },
    trigger(event, data) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(data);
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("real-time events", () => {
  it("service .realtime reports whether the client was configured with a socket", () => {
    const without = mantle({ url: BASE, storage: memoryStorage() });
    expect(without.service("messages").realtime).toBe(false);
    const withSocket = mantle({ url: BASE, storage: memoryStorage(), socket: { io: () => fakeSocket() } });
    expect(withSocket.service("messages").realtime).toBe(true);
  });

  it("service .on() without a socket option throws a GeneralError-shaped client error", () => {
    const client = mantle({ url: BASE, storage: memoryStorage() });
    expect(() => client.service("messages").on("created", () => undefined)).toThrow(MantleClientError);
    try {
      client.service("messages").on("created", () => undefined);
    } catch (e) {
      expect((e as MantleClientError).code).toBe(500);
      expect((e as MantleClientError).name).toBe("GeneralError");
    }
  });

  it("connects lazily on the first .on() and multiplexes handlers per event", async () => {
    const socket = fakeSocket();
    const io = vi.fn(() => socket);
    const client = mantle({ url: BASE, storage: memoryStorage(), socket: { io, transports: ["websocket"] } });

    expect(io).not.toHaveBeenCalled();
    const first = vi.fn();
    const second = vi.fn();
    client.service("messages").on("created", first).on("created", second);
    await flushMicrotasks();

    expect(io).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledWith(BASE, { transports: ["websocket"] });
    // one underlying socket listener for both handlers
    expect(socket.listeners.get("messages created")).toHaveLength(1);

    socket.trigger("messages created", { id: 1 });
    expect(first).toHaveBeenCalledWith({ id: 1 });
    expect(second).toHaveBeenCalledWith({ id: 1 });
  });

  it(".off() detaches the underlying socket listener when the last handler leaves", async () => {
    const socket = fakeSocket();
    const client = mantle({ url: BASE, storage: memoryStorage(), socket: { io: () => socket } });
    const handler = vi.fn();
    client.service("messages").on("removed", handler);
    await flushMicrotasks();
    client.service("messages").off("removed", handler);
    expect(socket.listeners.get("messages removed")).toHaveLength(0);
    socket.trigger("messages removed", { id: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("registers handlers added before the socket resolves", async () => {
    const socket = fakeSocket();
    const client = mantle({ url: BASE, storage: memoryStorage(), socket: { io: () => socket } });
    const created = vi.fn();
    const patched = vi.fn();
    client.service("messages").on("created", created);
    client.service("messages").on("patched", patched);
    await flushMicrotasks();
    socket.trigger("messages created", { id: 1 });
    socket.trigger("messages patched", { id: 2 });
    expect(created).toHaveBeenCalledWith({ id: 1 });
    expect(patched).toHaveBeenCalledWith({ id: 2 });
  });

  it("emits 'reconnect' on re-connects, not the initial connect (C-8)", async () => {
    const socket = fakeSocket();
    const client = mantle({ url: BASE, storage: memoryStorage(), socket: { io: () => socket } });
    const reconnect = vi.fn();
    client.on("reconnect", reconnect);
    client.service("messages").on("created", () => undefined);
    await flushMicrotasks();

    socket.trigger("connect");
    expect(reconnect).not.toHaveBeenCalled();
    socket.trigger("connect");
    socket.trigger("connect");
    expect(reconnect).toHaveBeenCalledTimes(2);
  });
});

describe("batch coalescing", () => {
  function batchClient(batch: boolean | { windowMs?: number; maxSize?: number } = true): MantleClient {
    return mantle({ url: BASE, storage: memoryStorage(), batch });
  }

  function sentCalls(callIndex = 0): unknown {
    const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return JSON.parse(call[1].body as string);
  }

  it("coalesces same-tick calls into one POST /batch and resolves each promise independently", async () => {
    const client = batchClient();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { status: "success", result: { id: 1, name: "Alice" } },
        { status: "success", result: [{ id: 9 }] },
      ]),
    );
    const [user, messages] = await Promise.all([
      client.service("users").get(1),
      client.service("messages").find({ query: { $limit: 5 } }),
    ]);
    expect(user).toEqual({ id: 1, name: "Alice" });
    expect(messages).toEqual([{ id: 9 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastRequest().url).toBe(`${BASE}/batch`);
    expect(lastRequest().init.method).toBe("POST");
    expect(sentCalls()).toEqual([
      { service: "users", method: "get", id: 1 },
      { service: "messages", method: "find", params: { query: { $limit: 5 } } },
    ]);
  });

  it("carries data for create/update/patch calls", async () => {
    const client = batchClient();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { status: "success", result: { id: 1 } },
        { status: "success", result: { id: 2 } },
      ]),
    );
    await Promise.all([
      client.service("users").create({ name: "Bob" }),
      client.service("users").patch(2, { name: "Carol" }),
    ]);
    expect(sentCalls()).toEqual([
      { service: "users", method: "create", data: { name: "Bob" } },
      { service: "users", method: "patch", id: 2, data: { name: "Carol" } },
    ]);
  });

  it("rejects a caller with MantleClientError from its error entry without failing siblings", async () => {
    const client = batchClient();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { status: "error", error: { name: "NotFound", message: "User not found", code: 404 } },
        { status: "success", result: [] },
      ]),
    );
    const [missing, ok] = await Promise.allSettled([client.service("users").get(1), client.service("messages").find()]);
    expect(missing.status).toBe("rejected");
    const reason = (missing as PromiseRejectedResult).reason as MantleClientError;
    expect(reason).toBeInstanceOf(MantleClientError);
    expect(reason).toMatchObject({ name: "NotFound", code: 404, message: "User not found" });
    expect(ok).toEqual({ status: "fulfilled", value: [] });
  });

  it("rejects every queued caller when the batch request itself fails", async () => {
    const client = batchClient();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const outcomes = await Promise.allSettled([client.service("users").get(1), client.service("messages").find()]);
    expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
  });

  it("splits queues longer than maxSize into multiple POST /batch requests", async () => {
    const client = batchClient({ maxSize: 2 });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          { status: "success", result: { id: 1 } },
          { status: "success", result: { id: 2 } },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([{ status: "success", result: { id: 3 } }]));
    const results = await Promise.all([
      client.service("users").get(1),
      client.service("users").get(2),
      client.service("users").get(3),
    ]);
    expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentCalls(0)).toHaveLength(2);
    expect(sentCalls(1)).toHaveLength(1);
  });

  it("waits windowMs before flushing when configured", async () => {
    vi.useFakeTimers();
    try {
      const client = batchClient({ windowMs: 10 });
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          { status: "success", result: { id: 1 } },
          { status: "success", result: { id: 2 } },
        ]),
      );
      const pending = Promise.all([client.service("users").get(1), client.service("users").get(2)]);
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(pending).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bypasses coalescing for calls with per-request headers", async () => {
    const client = batchClient();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));
    const result = await client.service("users").get(1, { headers: { "x-trace": "abc" } });
    expect(result).toEqual({ id: 1 });
    expect(lastRequest().url).toBe(`${BASE}/users/1`);
    expect(lastRequest().init.method).toBe("GET");
  });

  it("retries per-entry 401 failures once after a token refresh", async () => {
    const storage = memoryStorage();
    const client = mantle({ url: BASE, storage, batch: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: "at-1", refreshToken: "rt-1", user: {} }, 201));
    await client.authenticate({ strategy: "local" });
    fetchMock.mockClear();

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          { status: "error", error: { name: "NotAuthenticated", message: "expired", code: 401 } },
          { status: "success", result: [] },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ accessToken: "at-2", refreshToken: "rt-2" }, 201))
      .mockResolvedValueOnce(jsonResponse([{ status: "success", result: { id: 1 } }]));

    const [user, messages] = await Promise.all([client.service("users").get(1), client.service("messages").find()]);
    expect(user).toEqual({ id: 1 });
    expect(messages).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const refreshCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshCall[1].body).toBe(JSON.stringify({ strategy: "refresh", refreshToken: "rt-1" }));

    const retryCall = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryCall[1].headers as Record<string, string>)["authorization"]).toBe("Bearer at-2");
    expect(JSON.parse(retryCall[1].body as string)).toEqual([{ service: "users", method: "get", id: 1 }]);
  });

  it("rejects 401 entries with their original error when the refresh fails", async () => {
    const client = batchClient();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ status: "error", error: { name: "NotAuthenticated", message: "nope", code: 401 } }]),
    );
    await expect(client.service("users").get(1)).rejects.toMatchObject({ name: "NotAuthenticated", code: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
