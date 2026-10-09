import type { ReactNode } from "react";
import axe from "axe-core";
import { mantle, memoryStorage, type MantleClient, type SocketFactory } from "@mantlejs/client";
import { MantleProvider, type MantleProviderProps } from "@mantlejs/react";
import { QueryClient } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

export const API = "http://api.test";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The server's `MantleError.toJSON()` shape, as `@mantlejs/client` deserializes it. */
export function errorResponse(name: string, code: number, message: string, data?: unknown): Response {
  return jsonResponse({ name, code, message, className: name, ...(data === undefined ? {} : { data }) }, code);
}

export interface FakeSocket {
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  /** Deliver a service event (e.g. `"articles created"`) to every listener. */
  emit(event: string, data?: unknown): void;
}

export function fakeSocket(): FakeSocket {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    off(event, handler) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler),
      );
    },
    emit(event, data) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(data);
    },
  };
}

export interface Harness {
  client: MantleClient;
  fetchMock: Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>;
  socket: FakeSocket;
  queryClient: QueryClient;
  render(ui: ReactNode): RenderResult;
}

/**
 * A real `@mantlejs/client` against a stubbed `fetch` (and, with `realtime`, a fake socket), wrapped in
 * `<MantleProvider>` — blocks are exercised through the same client/hook stack a consumer app uses.
 */
export function createHarness(options: { realtime?: boolean } = {}): Harness {
  const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(jsonResponse([])));
  vi.stubGlobal("fetch", fetchMock);
  const socket = fakeSocket();
  const io: SocketFactory = () => socket;
  const client = mantle({ url: API, storage: memoryStorage(), ...(options.realtime ? { socket: { io } } : {}) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    fetchMock,
    socket,
    queryClient,
    render: (ui) =>
      render(
        // The cast is a monorepo-only artifact: tsc resolves @mantlejs/react from source through its
        // project reference, under that project's own nodenext options, which picks TanStack's .d.cts
        // typings while this project (bundler resolution) gets the .d.ts ones — same class, two
        // declarations. Consumers see @mantlejs/react's emitted .d.ts and don't hit it.
        <MantleProvider client={client} queryClient={queryClient as unknown as MantleProviderProps["queryClient"]}>
          {ui}
        </MantleProvider>,
      ),
  };
}

/** URLs of every `fetch` call so far. */
export function requestedUrls(fetchMock: Harness["fetchMock"]): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

/**
 * Zero axe violations. `region` is off because blocks render in isolation, not inside a page with
 * landmarks; `color-contrast` is off because jsdom has no layout or canvas to compute it with — the
 * colors come from the consumer's theme tokens anyway, not from the blocks.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
  });
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}
