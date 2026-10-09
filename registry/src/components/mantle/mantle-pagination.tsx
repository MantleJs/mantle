import type { Paginated } from "@mantlejs/client";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export interface MantlePaginationProps {
  /** The `Paginated<T>` envelope a `RepositoryService.find()` returns (only `total`/`limit`/`skip` are read). */
  page: Pick<Paginated<unknown>, "total" | "limit" | "skip">;
  /** Called with the new `$skip` when the user picks a page. */
  onSkipChange: (skip: number) => void;
  /** Real URLs per page (e.g. `?page=3`) for crawlable, open-in-new-tab links. Omit for in-place paging. */
  getHref?: (skip: number) => string;
  /** Page links shown either side of the current one before collapsing into "…". @default 1 */
  siblingCount?: number;
  className?: string;
}

/**
 * Page navigation for a `Paginated<T>` result: drives `$skip` in `limit`-sized steps, never computes
 * pages from anything but the envelope the server returned. Renders nothing for a single page.
 */
export function MantlePagination({ page, onSkipChange, getHref, siblingCount = 1, className }: MantlePaginationProps) {
  const { total, limit, skip } = page;
  if (limit <= 0 || total <= limit) return null;
  const pageCount = Math.ceil(total / limit);
  const current = Math.min(Math.floor(skip / limit), pageCount - 1);
  const go = (index: number) => ({
    href: getHref?.(index * limit),
    onPress: () => onSkipChange(index * limit),
  });

  return (
    <Pagination className={className}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious {...go(current - 1)} isDisabled={current === 0} />
        </PaginationItem>
        {pageWindow(pageCount, current, siblingCount).map((entry, position) =>
          entry === "gap" ? (
            <PaginationItem key={`gap-${position}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={entry}>
              <PaginationLink {...go(entry)} isActive={entry === current} aria-label={`Page ${entry + 1}`}>
                {entry + 1}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext {...go(current + 1)} isDisabled={current >= pageCount - 1} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

/**
 * Zero-based page indexes to render: always the first and last page, `siblings` either side of
 * `current`, and `"gap"` where a run is collapsed. A gap never stands in for a single page.
 */
export function pageWindow(pageCount: number, current: number, siblings = 1): Array<number | "gap"> {
  const pages = new Set<number>([0, pageCount - 1]);
  for (let index = current - siblings; index <= current + siblings; index++) {
    if (index >= 0 && index < pageCount) pages.add(index);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  sorted.forEach((index, position) => {
    const previous = sorted[position - 1];
    if (previous !== undefined && index - previous === 2) result.push(previous + 1);
    else if (previous !== undefined && index - previous > 2) result.push("gap");
    result.push(index);
  });
  return result;
}
