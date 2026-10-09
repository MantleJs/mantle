import { useState, type ReactNode } from "react";
import type { SortDescriptor } from "react-aria-components";
import type { Paginated } from "@mantlejs/client";
import { useFind } from "@mantlejs/react";
import { keepPreviousData } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { cn } from "cn";
import { MantlePagination } from "@/components/mantle/mantle-pagination";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface DataTableColumn<T> {
  /** Column key; also the record field it shows unless `field` says otherwise. */
  id: string;
  header: string;
  /** Record field read for the cell, sorted on (`$sort`), and requested (`$select`). @default id */
  field?: keyof T & string;
  /** Header becomes a sort toggle that drives `$sort` server-side. */
  sortable?: boolean;
  /** Custom cell. @default String(row[field]) */
  cell?: (row: T) => ReactNode;
  /** Marks the column screen readers announce as each row's name. @default the first column */
  isRowHeader?: boolean;
}

export interface DataTableProps<T> {
  /** Service path, e.g. `"articles"`. */
  service: string;
  columns: DataTableColumn<T>[];
  /** Accessible name of the table. */
  "aria-label": string;
  /** Fixed `where` filter merged into every `find()` query. */
  query?: Record<string, unknown>;
  /** Rows per page (`$limit`). Pagination controls appear when the result is `Paginated<T>`. */
  pageSize?: number;
  defaultSort?: { field: string; direction: "asc" | "desc" };
  /** Record id field. @default "id" */
  idField?: keyof T & string;
  /**
   * `$select` sent with every query. Default: the id field plus every column's field — pass the full
   * list yourself if a custom `cell` reads other fields, or `false` to fetch whole records.
   */
  select?: string[] | false;
  renderEmpty?: () => ReactNode;
  className?: string;
}

/**
 * A server-sorted, server-paged `find()` result in shadcn's React Aria `Table`. Column sort descriptors
 * map 1:1 onto `QueryParams.sort` (`$sort: { [field]: "asc" | "desc" }`), page changes onto `$skip`;
 * nothing is sorted or sliced client-side, so what's shown is exactly what the repository returned.
 */
export function DataTable<T extends object>({
  service,
  columns,
  "aria-label": ariaLabel,
  query,
  pageSize,
  defaultSort,
  idField = "id" as keyof T & string,
  select,
  renderEmpty,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortDescriptor | undefined>(
    defaultSort
      ? { column: defaultSort.field, direction: defaultSort.direction === "asc" ? "ascending" : "descending" }
      : undefined,
  );
  const [skip, setSkip] = useState(0);
  const fieldOf = (column: DataTableColumn<T>) => column.field ?? column.id;
  // React Aria requires a row-header column (it names each row for screen readers).
  const rowHeaderId = (columns.find((column) => column.isRowHeader) ?? columns[0])?.id;

  const selectFields = select === false ? undefined : (select ?? [...new Set([idField, ...columns.map(fieldOf)])]);
  const sortField = sort ? fieldOf(columns.find((column) => column.id === sort.column) ?? columns[0]) : undefined;
  const result = useFind<T>(
    service,
    {
      query: {
        ...query,
        ...(sort && sortField ? { $sort: { [sortField]: sort.direction === "ascending" ? "asc" : "desc" } } : {}),
        ...(pageSize ? { $limit: pageSize, $skip: skip } : {}),
        ...(selectFields ? { $select: selectFields } : {}),
      },
    },
    // Keep showing the current page while the next sort/page loads, instead of flashing empty.
    { placeholderData: keepPreviousData },
  );

  const rows = toArray(result.data);
  const page = result.data && !Array.isArray(result.data) ? (result.data as Paginated<T>) : undefined;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Table
        aria-label={ariaLabel}
        sortDescriptor={sort}
        onSortChange={(next) => {
          setSort(next);
          setSkip(0);
        }}
      >
        <TableHeader columns={columns}>
          {(column) => (
            <TableHead id={column.id} allowsSorting={column.sortable} isRowHeader={column.id === rowHeaderId}>
              {({ sortDirection }) => (
                <span className="inline-flex items-center gap-1">
                  {column.header}
                  {sortDirection === "ascending" && <ArrowUpIcon aria-hidden className="size-3.5" />}
                  {sortDirection === "descending" && <ArrowDownIcon aria-hidden className="size-3.5" />}
                </span>
              )}
            </TableHead>
          )}
        </TableHeader>
        <TableBody
          items={rows}
          dependencies={[columns]}
          renderEmptyState={() =>
            result.isPending ? (
              <span className="inline-flex justify-center">
                <Spinner />
              </span>
            ) : (
              <span className="text-muted-foreground">{renderEmpty ? renderEmpty() : "No results."}</span>
            )
          }
        >
          {(row) => (
            <TableRow id={String(row[idField])} columns={columns}>
              {(column) => (
                <TableCell>{column.cell ? column.cell(row) : String(row[fieldOf(column) as keyof T] ?? "")}</TableCell>
              )}
            </TableRow>
          )}
        </TableBody>
      </Table>
      {page && pageSize && <MantlePagination page={page} onSkipChange={setSkip} />}
    </div>
  );
}

function toArray<T>(data: T[] | Paginated<T> | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.data;
}
