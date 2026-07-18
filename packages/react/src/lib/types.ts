import type { MantleClient } from "@mantlejs/client";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

export interface MantleProviderProps {
  /** The `@mantlejs/client` instance every hook under this provider dispatches through. */
  client: MantleClient;
  /** Custom TanStack `QueryClient`. A default one is created when omitted. */
  queryClient?: QueryClient;
  children: ReactNode;
}

export interface MantleQueryOptions {
  /**
   * Automatic cache invalidation from real-time service events.
   * Default: enabled when the client has a socket configured, off otherwise.
   */
  realtime?: boolean;
}
