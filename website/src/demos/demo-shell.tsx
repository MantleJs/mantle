import { useState, type ReactNode } from "react";
import { mantle, memoryStorage, type MantleClient, type SocketFactory } from "@mantlejs/client";
import { MantleProvider } from "@mantlejs/react";
import { DEMO_API, installMockFetch } from "./mock-api";

/** Stands in for a Socket.IO connection: the demo emits the `"<path> <event>"` messages a server would push. */
export interface FakeSocket {
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, data?: unknown): void;
}

export function createFakeSocket(): FakeSocket {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    off(event, handler) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((candidate) => candidate !== handler),
      );
    },
    emit(event, data) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(data);
    },
  };
}

/**
 * A real `@mantlejs/client` + `<MantleProvider>` against the in-browser mock server — the block under
 * demo runs through exactly the client/hook stack a consumer app uses. Tokens live in memory, so a
 * demo login never touches this site's localStorage.
 */
export function createDemoClient(socket?: FakeSocket): MantleClient {
  installMockFetch();
  const io: SocketFactory | undefined = socket ? () => socket : undefined;
  return mantle({ url: DEMO_API, storage: memoryStorage(), ...(io ? { socket: { io } } : {}) });
}

export interface DemoShellProps {
  children: ReactNode;
  /** Supply a client to share it with controls outside the block (e.g. "simulate an event" buttons). */
  client?: MantleClient;
  /** Notes rendered under the block — what to try, what the mock server does. */
  footer?: ReactNode;
}

export function DemoShell({ children, client, footer }: DemoShellProps) {
  const [ownClient] = useState(() => client ?? createDemoClient());
  return (
    <div className="mantle-demo not-content rounded-xl border bg-background p-6 text-foreground">
      <MantleProvider client={ownClient}>{children}</MantleProvider>
      {footer && <div className="mt-6 border-t pt-4 text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Small status line demos use to echo a block's callbacks (`onSuccess`, `onSelect`, …). */
export function DemoLog({ entries }: { entries: string[] }) {
  if (entries.length === 0) return null;
  return (
    <ul aria-label="Demo events" className="mt-4 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
      {entries.map((entry, index) => (
        <li key={index}>{entry}</li>
      ))}
    </ul>
  );
}
