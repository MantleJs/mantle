import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createHarness, expectNoAxeViolations, jsonResponse, type Harness } from "@/test/harness";
import { RealtimeList, type RealtimeListProps } from "@/components/mantle/realtime-list";

interface Message {
  id: number;
  text: string;
  room: string;
}

const seed: Message[] = [
  { id: 1, text: "hello", room: "a" },
  { id: 2, text: "world", room: "a" },
];

async function setup(
  props: Partial<RealtimeListProps<Message>> = {},
  options: { realtime?: boolean; response?: unknown } = {},
) {
  const harness = createHarness({ realtime: options.realtime ?? true });
  harness.fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(options.response ?? seed)));
  const view = harness.render(
    <RealtimeList<Message>
      service="messages"
      aria-label="Messages"
      renderItem={(message) => message.text}
      textValue={(message) => message.text}
      {...props}
    />,
  );
  await screen.findByRole("grid", { name: "Messages" });
  // The client attaches socket listeners asynchronously once the socket is created.
  await act(async () => undefined);
  return { ...harness, view };
}

function rows(): string[] {
  return within(screen.getByRole("grid", { name: "Messages" }))
    .queryAllByRole("row")
    .map((row) => row.textContent ?? "");
}

async function emit(harness: Harness, event: string, data: unknown) {
  await act(async () => {
    harness.socket.emit(`messages ${event}`, data);
    // TanStack Query batches observer notifications onto a setTimeout(0) tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("RealtimeList", () => {
  it("renders the find() result", async () => {
    await setup();
    expect(rows()).toEqual(["hello", "world"]);
  });

  it("applies created/patched/removed events in place, without refetching", async () => {
    const harness = await setup();
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);

    await emit(harness, "created", { id: 3, text: "new", room: "a" });
    expect(rows()).toEqual(["hello", "world", "new"]);

    await emit(harness, "patched", { id: 1, text: "hello (edited)", room: "a" });
    expect(rows()).toEqual(["hello (edited)", "world", "new"]);

    await emit(harness, "removed", { id: 2, text: "world", room: "a" });
    expect(rows()).toEqual(["hello (edited)", "new"]);

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a duplicate created event and honours insert='start'", async () => {
    const harness = await setup({ insert: "start" });
    await emit(harness, "created", { id: 3, text: "first", room: "a" });
    await emit(harness, "created", { id: 3, text: "first", room: "a" });
    expect(rows()).toEqual(["first", "hello", "world"]);
  });

  it("keeps a Paginated<T> envelope's total in step", async () => {
    const harness = await setup({}, { response: { total: 2, limit: 10, skip: 0, data: seed } });
    await emit(harness, "created", { id: 3, text: "new", room: "a" });
    await emit(harness, "removed", { id: 1, text: "hello", room: "a" });
    const cached = harness.queryClient.getQueryData<{ total: number }>(["messages", "find"]);
    expect(cached?.total).toBe(2);
    expect(rows()).toEqual(["world", "new"]);
  });

  it("uses matches() to keep out — or drop — records outside the query's filter", async () => {
    const harness = await setup({ query: { room: "a" }, matches: (message) => message.room === "a" });
    await emit(harness, "created", { id: 3, text: "other room", room: "b" });
    expect(rows()).toEqual(["hello", "world"]);
    await emit(harness, "patched", { id: 1, text: "moved", room: "b" });
    expect(rows()).toEqual(["world"]);
  });

  it("is a plain static list when the client has no socket", async () => {
    const harness = await setup({}, { realtime: false });
    harness.socket.emit("messages created", { id: 3, text: "never", room: "a" });
    expect(rows()).toEqual(["hello", "world"]);
  });

  it("supports arrow-key navigation and Enter to activate an item", async () => {
    const onAction = vi.fn();
    await setup({ onAction });
    const user = userEvent.setup();

    await user.tab();
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(onAction).toHaveBeenCalledWith(seed[1]));
  });

  it("shows the empty state", async () => {
    await setup({ renderEmpty: () => "No messages" }, { response: [] });
    expect(screen.getByText("No messages")).toBeTruthy();
  });

  it("has no axe violations, populated or empty", async () => {
    const { view } = await setup({ onAction: () => undefined });
    await expectNoAxeViolations(view.container);
    view.unmount();
    const empty = await setup({}, { response: [] });
    await expectNoAxeViolations(empty.view.container);
  });
});
