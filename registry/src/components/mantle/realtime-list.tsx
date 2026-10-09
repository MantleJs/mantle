import { useEffect, useRef, type ReactNode } from "react";
import { GridList, GridListItem } from "react-aria-components";
import type { ClientParams, Id, Paginated } from "@mantlejs/client";
import { useFind, useMantleClient } from "@mantlejs/react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { cn } from "cn";
import { Spinner } from "@/components/ui/spinner";

export interface RealtimeListProps<T> {
  /** Service path, e.g. `"messages"`. */
  service: string;
  /** Passed to `find()` as `params.query` (`where` fields plus `$sort`/`$limit`/`$skip`/`$select`). */
  query?: Record<string, unknown>;
  /** Accessible name of the list. */
  "aria-label": string;
  renderItem: (item: T) => ReactNode;
  /** Plain-text label per item for typeahead and screen readers. @default String(item[idField]) */
  textValue?: (item: T) => string;
  /** Record id field. @default "id" */
  idField?: keyof T & string;
  /**
   * Which events to apply: a `created`/`patched`/`updated` record failing this is dropped from (or never
   * added to) the list. Use it to mirror `query`'s filter client-side. @default () => true
   */
  matches?: (item: T) => boolean;
  /** Where `created` records go. Match `query.$sort`. @default "end" */
  insert?: "start" | "end";
  /** Called when an item is activated (click, Enter). */
  onAction?: (item: T) => void;
  renderEmpty?: () => ReactNode;
  className?: string;
}

/**
 * A live `find()` result as a React Aria `GridList` (arrow-key navigation, typeahead, announced
 * updates). Service events (`created`/`updated`/`patched`/`removed` over the client's socket) are
 * written straight into the TanStack Query cache entry — the list changes in place with no refetch,
 * unlike `useFind({ realtime: true })`, which invalidates and refetches. With no socket configured it
 * is an ordinary static list.
 */
export function RealtimeList<T extends object>({
  service,
  query,
  "aria-label": ariaLabel,
  renderItem,
  textValue,
  idField = "id" as keyof T & string,
  matches = acceptAll,
  insert = "end",
  onAction,
  renderEmpty,
  className,
}: RealtimeListProps<T>) {
  const params: ClientParams | undefined = query ? { query } : undefined;
  // realtime: false — this component applies events itself instead of invalidating.
  const result = useFind<T>(service, params, { realtime: false });
  // The same key useFind caches under; TanStack Query compares keys by value.
  const queryKey: QueryKey = params === undefined ? [service, "find"] : [service, "find", params];
  useApplyServiceEvents<T>({ service, queryKey, idField, matches, insert });

  const items = toArray(result.data);
  const keyOf = (item: T) => item[idField] as unknown as Id;

  if (result.isPending) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  }
  return (
    <GridList
      aria-label={ariaLabel}
      items={items}
      selectionMode="none"
      onAction={
        onAction
          ? (key) => {
              const item = items.find((candidate) => String(keyOf(candidate)) === String(key));
              if (item) onAction(item);
            }
          : undefined
      }
      renderEmptyState={() => (
        <div className="p-4 text-center text-sm text-muted-foreground">
          {renderEmpty ? renderEmpty() : "Nothing here yet."}
        </div>
      )}
      className={cn("flex flex-col gap-1 outline-none", className)}
    >
      {(item) => (
        <GridListItem
          id={keyOf(item)}
          textValue={textValue ? textValue(item) : String(keyOf(item))}
          className={({ isFocusVisible, isHovered }) =>
            cn(
              "rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground outline-none",
              onAction && "cursor-pointer",
              isHovered && onAction && "bg-muted",
              isFocusVisible && "ring-3 ring-ring/50",
            )
          }
        >
          {renderItem(item)}
        </GridListItem>
      )}
    </GridList>
  );
}

function acceptAll(): boolean {
  return true;
}

interface ApplyOptions<T> {
  service: string;
  queryKey: QueryKey;
  idField: keyof T & string;
  matches: (item: T) => boolean;
  insert: "start" | "end";
}

function useApplyServiceEvents<T extends object>({ service, queryKey, idField, matches, insert }: ApplyOptions<T>) {
  const client = useMantleClient();
  const queryClient = useQueryClient();
  // Listeners read the latest props through this ref, so they don't resubscribe on every render.
  const latest = useRef({ queryKey, matches, insert });
  latest.current = { queryKey, matches, insert };
  const keyHash = JSON.stringify(queryKey);

  useEffect(() => {
    const serviceClient = client.service<T>(service);
    if (!serviceClient.realtime) return;
    const sameId = (a: T, b: T) => String(a[idField]) === String(b[idField]);
    const write = (change: (items: T[]) => T[]) => updateCache<T>(queryClient, latest.current.queryKey, change);

    const onCreated = (record: T) => {
      if (!latest.current.matches(record)) return;
      write((items) => {
        if (items.some((item) => sameId(item, record))) return items;
        return latest.current.insert === "start" ? [record, ...items] : [...items, record];
      });
    };
    const onChanged = (record: T) => {
      const keep = latest.current.matches(record);
      write((items) =>
        keep
          ? items.map((item) => (sameId(item, record) ? record : item))
          : items.filter((item) => !sameId(item, record)),
      );
    };
    const onRemoved = (record: T) => write((items) => items.filter((item) => !sameId(item, record)));

    serviceClient.on("created", onCreated).on("updated", onChanged).on("patched", onChanged).on("removed", onRemoved);
    return () => {
      serviceClient
        .off("created", onCreated)
        .off("updated", onChanged)
        .off("patched", onChanged)
        .off("removed", onRemoved);
    };
  }, [client, queryClient, service, keyHash, idField]);
}

/** Applies `change` to a cached find() result, keeping a `Paginated<T>` envelope's `total` in step. */
function updateCache<T>(queryClient: QueryClient, queryKey: QueryKey, change: (items: T[]) => T[]) {
  queryClient.setQueryData<T[] | Paginated<T>>(queryKey, (current) => {
    if (current === undefined) return current;
    if (Array.isArray(current)) return change(current);
    const data = change(current.data);
    return { ...current, data, total: current.total + (data.length - current.data.length) };
  });
}

function toArray<T>(data: T[] | Paginated<T> | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.data;
}
