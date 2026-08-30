import { describe, expect, it } from "vitest";
import type { FetchHandler } from "@mantlejs/http";
import { createApp, type Todo } from "./index.js";

describe("todo-minimal", () => {
  it("boots and runs a CRUD round-trip over the fetch handler", async () => {
    const app = createApp();
    const fetch = app.get<FetchHandler>("fetchHandler");

    const created = await fetch(
      new Request("http://localhost/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "write the README", done: false }),
      }),
    );
    expect(created.status).toBe(201);
    const todo = (await created.json()) as Todo;
    expect(todo.title).toBe("write the README");

    const patched = await fetch(
      new Request(`http://localhost/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ done: true }),
      }),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as Todo).done).toBe(true);

    const listed = await fetch(new Request("http://localhost/todos"));
    const page = (await listed.json()) as { data: Todo[]; total: number };
    expect(page.total).toBe(1);

    const removed = await fetch(new Request(`http://localhost/todos/${todo.id}`, { method: "DELETE" }));
    expect(removed.status).toBe(200);

    const emptied = await fetch(new Request("http://localhost/todos"));
    expect(((await emptied.json()) as { total: number }).total).toBe(0);
  });
});
