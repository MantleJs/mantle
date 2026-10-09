import type { ReactNode } from "react";
import { GridList, GridListItem } from "react-aria-components";
import type { ClientParams, Id, Paginated } from "@mantlejs/client";
import { useFind } from "@mantlejs/react";
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
 * updates). Uses `useFind`'s `realtime: { mode: "patch" }`: service events (`created`/`updated`/
 * `patched`/`removed` over the client's socket) are written straight into the cached result, so the
 * list changes in place with no refetch. With no socket configured it is an ordinary static list.
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
  const result = useFind<T>(service, params, { realtime: { mode: "patch", idField, matches, insert } });

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

function toArray<T>(data: T[] | Paginated<T> | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.data;
}
