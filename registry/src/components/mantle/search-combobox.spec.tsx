import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createHarness, errorResponse, expectNoAxeViolations, jsonResponse, requestedUrls } from "@/test/harness";
import { SearchCombobox, type SearchComboboxProps } from "@/components/mantle/search-combobox";

interface Article {
  id: number;
  title: string;
}

const results: Article[] = [
  { id: 1, title: "Getting started" },
  { id: 2, title: "Getting deployed" },
];

let serviceCounter = 0;

/** Each test gets its own service path — "auto" remembers a learned operator per service. */
function setup(props: Partial<SearchComboboxProps<Article>> = {}) {
  const harness = createHarness();
  const service = props.service ?? `articles-${++serviceCounter}`;
  const onSelect = vi.fn();
  const view = harness.render(
    <SearchCombobox<Article>
      service={service}
      field="title"
      label="Search articles"
      onSelect={onSelect}
      debounceMs={0}
      {...props}
    />,
  );
  return { ...harness, view, onSelect, service };
}

function decoded(urls: string[]): string[] {
  return urls.map((url) => decodeURIComponent(url));
}

describe("SearchCombobox", () => {
  it("queries with $ilike once minChars is reached and lists the matches", async () => {
    const { fetchMock, service } = setup({ query: { published: true }, limit: 5 });
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(results)));
    const user = userEvent.setup();

    await user.type(screen.getByRole("combobox", { name: "Search articles" }), "g");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(screen.getByRole("combobox"), "et");

    expect(await screen.findByRole("option", { name: "Getting started" })).toBeTruthy();
    expect(decoded(requestedUrls(fetchMock)).at(-1)).toBe(
      `http://api.test/${service}?published=true&title[$ilike]=%get%&$limit=5`,
    );
  });

  it("falls back to $like when the adapter rejects $ilike, and remembers it", async () => {
    const { fetchMock, service, view } = setup();
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        decodeURIComponent(String(input)).includes("$ilike")
          ? errorResponse("BadRequest", 400, "Operator $ilike is not supported by neo4j. Supported: $like")
          : jsonResponse(results),
      ),
    );
    const user = userEvent.setup();

    await user.type(screen.getByRole("combobox"), "get");
    expect(await screen.findByRole("option", { name: "Getting started" })).toBeTruthy();
    expect(decoded(requestedUrls(fetchMock)).at(-1)).toContain("title[$like]=%get%");

    // A second instance for the same service skips the $ilike probe entirely.
    view.unmount();
    const again = setup({ service });
    again.fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(results)));
    await user.type(screen.getByRole("combobox"), "dep");
    await screen.findByRole("option", { name: "Getting deployed" });
    expect(decoded(requestedUrls(again.fetchMock)).every((url) => !url.includes("$ilike"))).toBe(true);
  });

  it("never sends $ilike with operator='$like'", async () => {
    const { fetchMock } = setup({ operator: "$like" });
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(results)));
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "get");
    await screen.findByRole("option", { name: "Getting started" });
    expect(decoded(requestedUrls(fetchMock)).every((url) => url.includes("[$like]"))).toBe(true);
  });

  it("selects from the keyboard and returns the full record", async () => {
    const { fetchMock, onSelect } = setup();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ total: 2, limit: 10, skip: 0, data: results })));
    const user = userEvent.setup();

    await user.tab();
    await user.keyboard("get");
    await screen.findByRole("option", { name: "Getting started" });
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(results[1]));
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Getting deployed");
  });

  it("shows an empty state when nothing matches", async () => {
    const { fetchMock } = setup();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(await screen.findByText("No matches.")).toBeTruthy();
  });

  it("has no axe violations, closed and open", async () => {
    const { fetchMock, view } = setup();
    await expectNoAxeViolations(view.container);
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(results)));
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "get");
    await screen.findByRole("option", { name: "Getting started" });
    await expectNoAxeViolations(document.body);
  });
});
