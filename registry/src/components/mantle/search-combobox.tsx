import { useEffect, useState } from "react";
import type { Key } from "react-aria-components";
import { MantleClientError, type Paginated } from "@mantlejs/client";
import { useFind } from "@mantlejs/react";
import { keepPreviousData } from "@tanstack/react-query";
import { cn } from "cn";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";

export type SearchOperator = "$ilike" | "$like";

export interface SearchComboboxProps<T> {
  /** Service path, e.g. `"articles"`. */
  service: string;
  /** Record field matched against the typed text (`{ [field]: { $ilike: "%text%" } }`). */
  field: keyof T & string;
  /** Visible label (also the input's accessible name). */
  label: string;
  /** Called with the full record the user picked. */
  onSelect: (item: T) => void;
  /**
   * Match operator. `"auto"` (default) tries case-insensitive `$ilike` and falls back to `$like` for the
   * rest of the session if the service's adapter rejects `$ilike` — adapters reject unsupported
   * operators with a `BadRequest` naming the operator, and `describe().capabilities` isn't exposed
   * over HTTP. Pin `"$like"` for adapters you know lack `$ilike` (see the capability matrix) to skip
   * the probe request.
   */
  operator?: SearchOperator | "auto";
  /** Fixed `where` filter merged into every query. */
  query?: Record<string, unknown>;
  /** Max suggestions (`$limit`). @default 10 */
  limit?: number;
  /** Characters typed before the first request. @default 2 */
  minChars?: number;
  /** Delay after the last keystroke before querying. @default 250 */
  debounceMs?: number;
  /** Record id field. @default "id" */
  idField?: keyof T & string;
  /** Suggestion text. @default String(item[field]) */
  itemText?: (item: T) => string;
  placeholder?: string;
  className?: string;
}

/** Operators learned per service by `operator="auto"` — one rejected probe per service per page load. */
const learnedOperators = new Map<string, SearchOperator>();

/**
 * Type-ahead search over a service's `find()`: shadcn's React Aria `Combobox` (listbox popup, arrow-key
 * navigation, announced result counts) with the filtering done server-side by a `$ilike`/`$like` query.
 * The typed text is wrapped in `%…%` as-is — `%` and `_` the user types act as wildcards.
 */
export function SearchCombobox<T extends object>({
  service,
  field,
  label,
  onSelect,
  operator = "auto",
  query,
  limit = 10,
  minChars = 2,
  debounceMs = 250,
  idField = "id" as keyof T & string,
  itemText,
  placeholder,
  className,
}: SearchComboboxProps<T>) {
  const [text, setText] = useState("");
  const term = useDebounced(text.trim(), debounceMs);
  const [learned, setLearned] = useState<SearchOperator | undefined>(() => learnedOperators.get(service));
  const op: SearchOperator = operator === "auto" ? (learned ?? "$ilike") : operator;

  const result = useFind<T>(
    service,
    { query: { ...query, [field]: { [op]: `%${term}%` }, $limit: limit } },
    {
      enabled: term.length >= minChars,
      realtime: false,
      placeholderData: keepPreviousData,
      // A 4xx (e.g. the $ilike probe being rejected) won't succeed on retry — fail fast so "auto"
      // falls back immediately instead of after TanStack's default three retries.
      retry: (failures, error) => error.code >= 500 && failures < 3,
    },
  );

  useEffect(() => {
    if (operator === "auto" && op === "$ilike" && rejectsOperator(result.error, "$ilike")) {
      learnedOperators.set(service, "$like");
      setLearned("$like");
    }
  }, [operator, op, result.error, service]);

  const items = term.length >= minChars ? toArray(result.data) : [];
  const textOf = (item: T) => (itemText ? itemText(item) : String(item[field] ?? ""));
  const keyOf = (item: T): Key => String(item[idField]);

  return (
    <Combobox
      items={items}
      inputValue={text}
      onInputChange={setText}
      onSelectionChange={(key) => {
        const item = items.find((candidate) => keyOf(candidate) === key);
        if (!item) return;
        setText(textOf(item));
        onSelect(item);
      }}
      allowsEmptyCollection={term.length >= minChars}
      allowsCustomValue
      menuTrigger="input"
      className={cn("flex flex-col gap-2", className)}
    >
      <Label>{label}</Label>
      <ComboboxInput placeholder={placeholder} showTrigger={false} />
      <ComboboxContent>
        <ComboboxList<T> items={items}>
          {(item) => (
            <ComboboxItem id={keyOf(item)} textValue={textOf(item)}>
              {textOf(item)}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>{result.isFetching ? "Searching…" : "No matches."}</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}

function rejectsOperator(error: unknown, operator: string): boolean {
  return error instanceof MantleClientError && error.name === "BadRequest" && error.message.includes(operator);
}

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function toArray<T>(data: T[] | Paginated<T> | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.data;
}
