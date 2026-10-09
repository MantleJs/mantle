import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/harness";
import { MantlePagination, pageWindow } from "@/components/mantle/mantle-pagination";

describe("pageWindow", () => {
  it.each<[number, number, Array<number | "gap">]>([
    [1, 0, [0]],
    [5, 0, [0, 1, "gap", 4]],
    [10, 5, [0, "gap", 4, 5, 6, "gap", 9]],
    [8, 2, [0, 1, 2, 3, "gap", 7]],
    // A gap would hide exactly one page (pages 1 and 5 here) — show the page instead.
    [7, 3, [0, 1, 2, 3, 4, 5, 6]],
    [5, 2, [0, 1, 2, 3, 4]],
  ])("pageCount=%i current=%i → %j", (pageCount, current, expected) => {
    expect(pageWindow(pageCount, current)).toEqual(expected);
  });
});

describe("MantlePagination", () => {
  const page = { total: 95, limit: 10, skip: 40 };

  it("renders nothing for a single page", () => {
    const { container } = render(<MantlePagination page={{ total: 8, limit: 10, skip: 0 }} onSkipChange={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("marks the current page and reports the new $skip", async () => {
    const onSkipChange = vi.fn();
    render(<MantlePagination page={page} onSkipChange={onSkipChange} />);
    const user = userEvent.setup();

    expect(screen.getByRole("link", { name: "Page 5" }).getAttribute("aria-current")).toBe("page");
    await user.click(screen.getByRole("link", { name: "Page 10" }));
    expect(onSkipChange).toHaveBeenLastCalledWith(90);
    await user.click(screen.getByRole("link", { name: "Go to next page" }));
    expect(onSkipChange).toHaveBeenLastCalledWith(50);
    await user.click(screen.getByRole("link", { name: "Go to previous page" }));
    expect(onSkipChange).toHaveBeenLastCalledWith(30);
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(<MantlePagination page={{ ...page, skip: 0 }} onSkipChange={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Go to previous page" }).getAttribute("aria-disabled")).toBe("true");
    rerender(<MantlePagination page={{ ...page, skip: 90 }} onSkipChange={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Go to next page" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("renders real hrefs with getHref", () => {
    render(<MantlePagination page={page} onSkipChange={vi.fn()} getHref={(skip) => `?skip=${skip}`} />);
    expect(screen.getByRole("link", { name: "Page 6" }).getAttribute("href")).toBe("?skip=50");
  });

  it("is operable keyboard-only", async () => {
    const onSkipChange = vi.fn();
    render(<MantlePagination page={page} onSkipChange={onSkipChange} />);
    const user = userEvent.setup();
    const target = screen.getByRole("link", { name: "Page 6" });
    while (document.activeElement !== target) await user.tab();
    await user.keyboard("{Enter}");
    expect(onSkipChange).toHaveBeenCalledWith(50);
  });

  it("has no axe violations", async () => {
    const { container } = render(<MantlePagination page={page} onSkipChange={vi.fn()} />);
    await expectNoAxeViolations(container);
  });
});
