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

/**
 * `useFind`'s in-place cache mode: service events are written straight into this hook's cached
 * `find()` result instead of invalidating it, so the list changes with no refetch. Events carry the
 * full record, but the client can't re-run the server's `where`/`$sort` — `matches` and `insert`
 * mirror them. The provider still invalidates everything on socket reconnect, so events missed while
 * disconnected are recovered by one refetch.
 */
export interface RealtimePatchOptions<T> {
  mode: "patch";
  /** Record id field events are matched on. @default "id" */
  idField?: keyof T & string;
  /**
   * Whether a `created`/`updated`/`patched` record belongs in this result — mirror the query's
   * filter. A changed record that stops matching is removed. @default () => true
   */
  matches?: (record: T) => boolean;
  /** Where `created` records go — mirror the query's `$sort`. @default "end" */
  insert?: "start" | "end";
}

/** `useFind`'s options extension: `realtime` additionally accepts the in-place patch mode. */
export interface MantleFindOptions<T> {
  /**
   * `true`/omitted: invalidate (refetch) on service events when a socket is configured. `false`: off.
   * `{ mode: "patch" }`: apply events to the cached result in place, no refetch.
   */
  realtime?: boolean | RealtimePatchOptions<T>;
}
