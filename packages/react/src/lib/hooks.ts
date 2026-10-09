import type { ClientParams, Id, MantleClientError, Paginated } from "@mantlejs/client";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useMantleContext } from "./provider.js";
import type { MantleFindOptions, MantleQueryOptions, RealtimePatchOptions } from "./types.js";

type QueryHookOptions<TData> = Omit<UseQueryOptions<TData, MantleClientError>, "queryKey" | "queryFn"> &
  MantleQueryOptions;

type MutationHookOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, MantleClientError, TVariables>,
  "mutationFn"
>;

/** Subscribes the service to socket-driven cache invalidation for the lifetime of the hook. */
function useServiceRealtime(service: string, realtime: boolean | undefined): void {
  const { registry } = useMantleContext();
  useEffect(() => {
    if (realtime === false) return;
    return registry.subscribe(service);
  }, [registry, service, realtime]);
}

type FindHookOptions<T> = Omit<UseQueryOptions<T[] | Paginated<T>, MantleClientError>, "queryKey" | "queryFn"> &
  MantleFindOptions<T>;

/**
 * `useQuery` over `service.find(params)` with key `[service, "find", params?]`. With
 * `realtime: { mode: "patch" }`, service events update the cached result in place instead of
 * triggering a refetch.
 */
export function useFind<T>(
  service: string,
  params?: ClientParams,
  options?: FindHookOptions<T>,
): UseQueryResult<T[] | Paginated<T>, MantleClientError> {
  const { client } = useMantleContext();
  const { realtime, ...queryOptions } = options ?? {};
  const patch = typeof realtime === "object" ? realtime : undefined;
  const queryKey: QueryKey = params === undefined ? [service, "find"] : [service, "find", params];
  // Patch mode replaces invalidation for this hook — otherwise every event would also refetch.
  useServiceRealtime(service, patch ? false : (realtime as boolean | undefined));
  useServicePatches<T>(service, queryKey, patch);
  return useQuery({
    ...queryOptions,
    queryKey,
    queryFn: () => client.service<T>(service).find(params),
  });
}

/** Writes `created`/`updated`/`patched`/`removed` events into one cached find() result. */
function useServicePatches<T>(service: string, queryKey: QueryKey, patch: RealtimePatchOptions<T> | undefined): void {
  const { client } = useMantleContext();
  const queryClient = useQueryClient();
  // Listeners read the latest key/options through a ref, so inline `matches` callbacks and
  // structurally-equal params don't resubscribe on every render.
  const latest = useRef({ queryKey, patch });
  latest.current = { queryKey, patch };
  const enabled = patch !== undefined;
  const idField = patch?.idField ?? "id";
  const keyHash = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled) return;
    const serviceClient = client.service<T>(service);
    if (!serviceClient.realtime) return;
    const idOf = (record: T): string => String((record as Record<string, unknown>)[idField]);
    const matches = (record: T): boolean => latest.current.patch?.matches?.(record) ?? true;
    const write = (change: (items: T[]) => T[]): void =>
      writeFindCache<T>(queryClient, latest.current.queryKey, change);

    const onCreated = (record: T): void => {
      if (!matches(record)) return;
      write((items) => {
        if (items.some((item) => idOf(item) === idOf(record))) return items;
        return latest.current.patch?.insert === "start" ? [record, ...items] : [...items, record];
      });
    };
    const onChanged = (record: T): void => {
      const keep = matches(record);
      write((items) => {
        const present = items.some((item) => idOf(item) === idOf(record));
        if (!keep) return present ? items.filter((item) => idOf(item) !== idOf(record)) : items;
        // A change can make a record newly match the query — treat it like a create.
        if (!present) return latest.current.patch?.insert === "start" ? [record, ...items] : [...items, record];
        return items.map((item) => (idOf(item) === idOf(record) ? record : item));
      });
    };
    const onRemoved = (record: T): void => write((items) => items.filter((item) => idOf(item) !== idOf(record)));

    serviceClient.on("created", onCreated).on("updated", onChanged).on("patched", onChanged).on("removed", onRemoved);
    return () => {
      serviceClient
        .off("created", onCreated)
        .off("updated", onChanged)
        .off("patched", onChanged)
        .off("removed", onRemoved);
    };
    // keyHash, not queryKey: a new-but-equal params object must not resubscribe.
  }, [client, queryClient, service, keyHash, idField, enabled]);
}

/** Applies `change` to a cached find() result, keeping a `Paginated<T>` envelope's `total` in step. */
function writeFindCache<T>(queryClient: QueryClient, queryKey: QueryKey, change: (items: T[]) => T[]): void {
  queryClient.setQueryData<T[] | Paginated<T>>(queryKey, (current) => {
    if (current === undefined) return current;
    if (Array.isArray(current)) return change(current);
    const data = change(current.data);
    if (data === current.data) return current;
    return { ...current, data, total: current.total + (data.length - current.data.length) };
  });
}

/** `useQuery` over `service.get(id, params)` with key `[service, "get", id, params?]`. */
export function useGet<T>(
  service: string,
  id: Id,
  params?: ClientParams,
  options?: QueryHookOptions<T>,
): UseQueryResult<T, MantleClientError> {
  const { client } = useMantleContext();
  const { realtime, ...queryOptions } = options ?? {};
  useServiceRealtime(service, realtime);
  return useQuery({
    ...queryOptions,
    queryKey: params === undefined ? [service, "get", id] : [service, "get", id, params],
    queryFn: () => client.service<T>(service).get(id, params),
  });
}

/** `useMutation` over `service.create(data)`. */
export function useCreate<T>(
  service: string,
  options?: MutationHookOptions<T, Partial<T>>,
): UseMutationResult<T, MantleClientError, Partial<T>> {
  const { client } = useMantleContext();
  return useMutation({ ...options, mutationFn: (data) => client.service<T>(service).create(data) });
}

/** `useMutation` over `service.update(id, data)`. */
export function useUpdate<T>(
  service: string,
  options?: MutationHookOptions<T, { id: Id; data: Partial<T> }>,
): UseMutationResult<T, MantleClientError, { id: Id; data: Partial<T> }> {
  const { client } = useMantleContext();
  return useMutation({ ...options, mutationFn: ({ id, data }) => client.service<T>(service).update(id, data) });
}

/** `useMutation` over `service.patch(id, data)`. */
export function usePatch<T>(
  service: string,
  options?: MutationHookOptions<T, { id: Id; data: Partial<T> }>,
): UseMutationResult<T, MantleClientError, { id: Id; data: Partial<T> }> {
  const { client } = useMantleContext();
  return useMutation({ ...options, mutationFn: ({ id, data }) => client.service<T>(service).patch(id, data) });
}

/** `useMutation` over `service.remove(id)`. */
export function useRemove<T>(
  service: string,
  options?: MutationHookOptions<T, Id>,
): UseMutationResult<T, MantleClientError, Id> {
  const { client } = useMantleContext();
  return useMutation({ ...options, mutationFn: (id) => client.service<T>(service).remove(id) });
}
