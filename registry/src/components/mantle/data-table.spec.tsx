import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createHarness, expectNoAxeViolations, jsonResponse, requestedUrls } from "@/test/harness";
import { DataTable, type DataTableColumn, type DataTableProps } from "@/components/mantle/data-table";

interface Article {
  id: number;
  title: string;
  views: number;
}

const columns: DataTableColumn<Article>[] = [
  { id: "title", header: "Title", sortable: true, isRowHeader: true },
  { id: "views", header: "Views", sortable: true },
];

const page = (skip: number, total = 25) => ({
  total,
  limit: 10,
  skip,
  data: [
    { id: skip + 1, title: `Article ${skip + 1}`, views: 3 },
    { id: skip + 2, title: `Article ${skip + 2}`, views: 7 },
  ],
});

/** Decodes the last find() URL's query string into its bracket-notation keys. */
function lastQuery(urls: string[]): Record<string, string> {
  const url = new URL(urls[urls.length - 1]);
  return Object.fromEntries(url.searchParams.entries());
}

async function setup(props: Partial<DataTableProps<Article>> = {}) {
  const harness = createHarness();
  harness.fetchMock.mockImplementation((input) => {
    const skip = Number(new URL(String(input)).searchParams.get("$skip") ?? 0);
    return Promise.resolve(jsonResponse(page(skip)));
  });
  const view = harness.render(
    <DataTable<Article> service="articles" columns={columns} aria-label="Articles" {...props} />,
  );
  await screen.findByText("Article 1");
  return { ...harness, view };
}

describe("DataTable", () => {
  it("requests only the shown fields and renders rows", async () => {
    const { fetchMock } = await setup({ query: { published: true } });
    expect(lastQuery(requestedUrls(fetchMock))).toEqual({
      published: "true",
      "$select[0]": "id",
      "$select[1]": "title",
      "$select[2]": "views",
    });
    const body = screen.getAllByRole("rowgroup")[1];
    const cells = within(body)
      .getAllByRole("row")
      .map((row) => [...row.children].map((cell) => cell.textContent).join(" | "));
    expect(cells).toEqual(["Article 1 | 3", "Article 2 | 7"]);
  });

  it("maps a header click onto QueryParams.sort ($sort), toggling direction", async () => {
    const { fetchMock } = await setup();
    const user = userEvent.setup();

    await user.click(screen.getByRole("columnheader", { name: "Title" }));
    await waitFor(() => expect(lastQuery(requestedUrls(fetchMock))["$sort[title]"]).toBe("asc"));
    expect(screen.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort")).toBe("ascending");

    await user.click(screen.getByRole("columnheader", { name: "Title" }));
    await waitFor(() => expect(lastQuery(requestedUrls(fetchMock))["$sort[title]"]).toBe("desc"));

    await user.click(screen.getByRole("columnheader", { name: "Views" }));
    await waitFor(() => expect(lastQuery(requestedUrls(fetchMock))["$sort[views]"]).toBe("asc"));
    expect(lastQuery(requestedUrls(fetchMock))["$sort[title]"]).toBeUndefined();
  });

  it("sorts by the column's field when it differs from its id, and honours defaultSort", async () => {
    const { fetchMock } = await setup({
      columns: [{ id: "name", field: "title", header: "Name", sortable: true }],
      defaultSort: { field: "name", direction: "desc" },
      select: false,
    });
    expect(lastQuery(requestedUrls(fetchMock))).toEqual({ "$sort[title]": "desc" });
  });

  it("pages with $limit/$skip and resets to the first page on sort", async () => {
    const { fetchMock } = await setup({ pageSize: 10 });
    const user = userEvent.setup();
    expect(lastQuery(requestedUrls(fetchMock))).toMatchObject({ $limit: "10", $skip: "0" });

    await user.click(screen.getByRole("link", { name: "Page 3" }));
    await screen.findByText("Article 21");
    expect(lastQuery(requestedUrls(fetchMock))).toMatchObject({ $skip: "20" });
    expect(screen.getByRole("link", { name: "Page 3" }).getAttribute("aria-current")).toBe("page");

    await user.click(screen.getByRole("columnheader", { name: "Views" }));
    await waitFor(() =>
      expect(lastQuery(requestedUrls(fetchMock))).toMatchObject({ $skip: "0", "$sort[views]": "asc" }),
    );
  });

  it("sorts from the keyboard", async () => {
    const { fetchMock } = await setup();
    const user = userEvent.setup();

    await user.tab();
    // Grid focus lands on the first cell; move up into the header row, then activate.
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement?.textContent).toBe("Title");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(lastQuery(requestedUrls(fetchMock))["$sort[title]"]).toBe("asc"));
  });

  it("has no axe violations, unsorted and sorted with pagination", async () => {
    const { view } = await setup({ pageSize: 10 });
    await expectNoAxeViolations(view.container);
    const user = userEvent.setup();
    await user.click(screen.getByRole("columnheader", { name: "Title" }));
    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort")).toBe("ascending"),
    );
    await expectNoAxeViolations(view.container);
  });
});
