import type { MantleClient } from "@mantlejs/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactElement } from "react";
import { RealtimeRegistry } from "./realtime-registry.js";
import type { MantleProviderProps } from "./types.js";

interface MantleContextValue {
  client: MantleClient;
  registry: RealtimeRegistry;
}

const MantleContext = createContext<MantleContextValue | null>(null);

/**
 * Stores the `MantleClient` in context and wraps children in a
 * `QueryClientProvider` (creating a default `QueryClient` when none is given).
 */
export function MantleProvider({ client, queryClient, children }: MantleProviderProps): ReactElement {
  const [fallbackQueryClient] = useState(() => new QueryClient());
  const resolvedQueryClient = queryClient ?? fallbackQueryClient;
  const value = useMemo(
    () => ({ client, registry: new RealtimeRegistry(client, resolvedQueryClient) }),
    [client, resolvedQueryClient],
  );

  // C-8: a re-connect may have missed events (at-most-once delivery), so
  // invalidate every query to bound staleness.
  useEffect(() => {
    const invalidateAll = (): void => {
      void resolvedQueryClient.invalidateQueries();
    };
    client.on("reconnect", invalidateAll);
    return () => {
      client.off("reconnect", invalidateAll);
    };
  }, [client, resolvedQueryClient]);

  return (
    <MantleContext.Provider value={value}>
      <QueryClientProvider client={resolvedQueryClient}>{children}</QueryClientProvider>
    </MantleContext.Provider>
  );
}

/** Internal — hooks resolve the client and realtime registry through this. */
export function useMantleContext(): MantleContextValue {
  const value = useContext(MantleContext);
  if (!value) {
    throw new Error(
      "useMantleClient and the Mantle query/mutation hooks must be used within a <MantleProvider> — wrap your app in <MantleProvider client={mantle({ url })}>",
    );
  }
  return value;
}

/** The `MantleClient` from the nearest `MantleProvider`. */
export function useMantleClient(): MantleClient {
  return useMantleContext().client;
}
