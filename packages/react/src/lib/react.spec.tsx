import { mantle, MantleClientError, memoryStorage, type MantleClient } from "@mantlejs/client";
import { QueryClient } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  MantleProvider,
  useCreate,
  useFind,
  useGet,
  useMantleClient,
  usePatch,
  useRemove,
  useUpdate,
} from "../index.js";

const BASE = "http://api.test";

interface Message {
  id: number;
  text: string;
}

interface FakeSocket {
  listeners: Map<string, Array<(...args: unknown[]) => void>>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  trigger(event: string, data?: unknown): void;
}

function fakeSocket(): FakeSocket {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    listeners,
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    off(event, handler) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler),
      );
    },
    trigger(event, data) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(data);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createClient(socket?: FakeSocket): MantleClient {
  return mantle({
    url: BASE,
    storage: memoryStorage(),
    ...(socket ? { socket: { io: () => socket } } : {}),
  });
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createWrapper(client: MantleClient, queryClient?: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return (
      <MantleProvider client={client} queryClient={queryClient}>
        {children}
      </MantleProvider>
    );
  };
}

function requestAt(index: number): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

describe("MantleProvider / useMantleClient", () => {
  it("returns the provider's client", () => {
    const client = createClient();
    const { result } = renderHook(() => useMantleClient(), { wrapper: createWrapper(client, createQueryClient()) });
    expect(result.current).toBe(client);
  });

  it("throws a descriptive error outside a MantleProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useMantleClient())).toThrow(/<MantleProvider>/);
  });

  it("creates a default QueryClient when none is provided", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1, text: "hi" }]));
    const { result } = renderHook(() => useFind<Message>("messages"), { wrapper: createWrapper(createClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1, text: "hi" }]);
  });
});

describe("query hooks", () => {
  it("useFind issues GET /:service and caches under [service, 'find']", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 1, limit: 10, skip: 0, data: [{ id: 1, text: "hi" }] }));
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useFind<Message>("messages"), {
      wrapper: createWrapper(createClient(), queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestAt(0).url).toBe(`${BASE}/messages`);
    expect(requestAt(0).init.method).toBe("GET");
    expect(queryClient.getQueryData(["messages", "find"])).toEqual(result.current.data);
  });

  it("useFind serializes params into the URL and the query key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const queryClient = createQueryClient();
    const params = { query: { done: false } };
    const { result } = renderHook(() => useFind<Message>("todos", params), {
      wrapper: createWrapper(createClient(), queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestAt(0).url).toBe(`${BASE}/todos?done=false`);
    expect(queryClient.getQueryData(["todos", "find", params])).toEqual([]);
  });

  it("useGet issues GET /:service/:id and caches under [service, 'get', id]", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, text: "hi" }));
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useGet<Message>("messages", 1), {
      wrapper: createWrapper(createClient(), queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestAt(0).url).toBe(`${BASE}/messages/1`);
    expect(queryClient.getQueryData(["messages", "get", 1])).toEqual({ id: 1, text: "hi" });
  });

  it("surfaces server errors as MantleClientError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ name: "NotFound", message: "Message not found", code: 404, className: "not-found" }, 404),
    );
    const { result } = renderHook(() => useGet<Message>("messages", 99), {
      wrapper: createWrapper(createClient(), createQueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(MantleClientError);
    expect(result.current.error?.code).toBe(404);
  });

  it("passes TanStack options through (enabled: false suppresses the fetch)", async () => {
    const { result } = renderHook(() => useFind<Message>("messages", undefined, { enabled: false }), {
      wrapper: createWrapper(createClient(), createQueryClient()),
    });
    await act(async () => Promise.resolve());
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mutation hooks", () => {
  function renderMutations(queryClient = createQueryClient()) {
    return renderHook(
      () => ({
        create: useCreate<Message>("messages"),
        update: useUpdate<Message>("messages"),
        patch: usePatch<Message>("messages"),
        remove: useRemove<Message>("messages"),
      }),
      { wrapper: createWrapper(createClient(), queryClient) },
    );
  }

  it("useCreate POSTs the data and resolves with the created record", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, text: "hi" }, 201));
    const { result } = renderMutations();
    const created = await act(() => result.current.create.mutateAsync({ text: "hi" }));
    expect(created).toEqual({ id: 1, text: "hi" });
    expect(requestAt(0).init.method).toBe("POST");
    expect(requestAt(0).url).toBe(`${BASE}/messages`);
    expect(requestAt(0).init.body).toBe(JSON.stringify({ text: "hi" }));
  });

  it("useUpdate, usePatch, useRemove map to PUT, PATCH, DELETE on /:service/:id", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: 1, text: "x" })));
    const { result } = renderMutations();
    await act(() => result.current.update.mutateAsync({ id: 1, data: { text: "a" } }));
    expect(requestAt(0).init.method).toBe("PUT");
    await act(() => result.current.patch.mutateAsync({ id: 1, data: { text: "b" } }));
    expect(requestAt(1).init.method).toBe("PATCH");
    await act(() => result.current.remove.mutateAsync(1));
    expect(requestAt(2).init.method).toBe("DELETE");
    expect(requestAt(2).url).toBe(`${BASE}/messages/1`);
  });

  it("mutations reject with MantleClientError and never invalidate the cache themselves", async () => {
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ name: "Unprocessable", message: "Validation failed", code: 422, className: "unprocessable" }, 422),
    );
    const { result } = renderMutations(queryClient);
    await expect(act(() => result.current.create.mutateAsync({ text: "" }))).rejects.toBeInstanceOf(MantleClientError);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, text: "ok" }, 201));
    await act(() => result.current.create.mutateAsync({ text: "ok" }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("real-time cache invalidation", () => {
  const SERVICE_EVENT_NAMES = ["messages created", "messages updated", "messages patched", "messages removed"];

  function FindProbe({ service, realtime }: { service: string; realtime?: boolean }): ReactNode {
    useFind<Message>(service, undefined, realtime === undefined ? undefined : { realtime });
    return null;
  }

  it("registers one listener set per service, shared across hooks, and invalidates the service key prefix", async () => {
    const socket = fakeSocket();
    const client = createClient(socket);
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <MantleProvider client={client} queryClient={queryClient}>
        <FindProbe service="messages" />
        <FindProbe service="messages" />
      </MantleProvider>,
    );

    await waitFor(() => {
      for (const name of SERVICE_EVENT_NAMES) expect(socket.listeners.get(name)).toHaveLength(1);
    });

    act(() => socket.trigger("messages created", { id: 2, text: "new" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
  });

  it("removes socket listeners only when the last hook for the service unmounts", async () => {
    const socket = fakeSocket();
    const client = createClient(socket);
    const queryClient = createQueryClient();

    const { rerender } = render(
      <MantleProvider client={client} queryClient={queryClient}>
        <FindProbe service="messages" />
        <FindProbe service="messages" />
      </MantleProvider>,
    );
    await waitFor(() => expect(socket.listeners.get("messages created")).toHaveLength(1));

    rerender(
      <MantleProvider client={client} queryClient={queryClient}>
        <FindProbe service="messages" />
      </MantleProvider>,
    );
    expect(socket.listeners.get("messages created")).toHaveLength(1);

    rerender(<MantleProvider client={client} queryClient={queryClient} children={null} />);
    for (const name of SERVICE_EVENT_NAMES) expect(socket.listeners.get(name) ?? []).toHaveLength(0);
  });

  it("realtime: false opts the hook out of subscriptions", async () => {
    const socket = fakeSocket();
    const io = vi.fn(() => socket);
    const client = mantle({ url: BASE, storage: memoryStorage(), socket: { io } });
    const { result } = renderHook(() => useFind<Message>("messages", undefined, { realtime: false }), {
      wrapper: createWrapper(client, createQueryClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(io).not.toHaveBeenCalled();
  });

  it("hooks work without a socket configured — no subscription, no throw", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1, text: "hi" }]));
    const { result } = renderHook(() => useFind<Message>("messages"), {
      wrapper: createWrapper(createClient(), createQueryClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1, text: "hi" }]);
  });

  it("invalidates every query on client 'reconnect' (C-8)", async () => {
    const socket = fakeSocket();
    const client = createClient(socket);
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useFind<Message>("messages"), { wrapper: createWrapper(client, queryClient) });
    await waitFor(() => expect(socket.listeners.get("connect")).toHaveLength(1));

    act(() => socket.trigger("connect"));
    expect(invalidate).not.toHaveBeenCalledWith();
    act(() => socket.trigger("connect"));
    expect(invalidate).toHaveBeenCalledWith();
  });
});
