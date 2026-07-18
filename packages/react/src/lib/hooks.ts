import type { ClientParams, Id, MantleClientError, Paginated } from "@mantlejs/client";
import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { useMantleContext } from "./provider.js";
import type { MantleQueryOptions } from "./types.js";

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

/** `useQuery` over `service.find(params)` with key `[service, "find", params?]`. */
export function useFind<T>(
  service: string,
  params?: ClientParams,
  options?: QueryHookOptions<T[] | Paginated<T>>,
): UseQueryResult<T[] | Paginated<T>, MantleClientError> {
  const { client } = useMantleContext();
  const { realtime, ...queryOptions } = options ?? {};
  useServiceRealtime(service, realtime);
  return useQuery({
    ...queryOptions,
    queryKey: params === undefined ? [service, "find"] : [service, "find", params],
    queryFn: () => client.service<T>(service).find(params),
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
