import { describe, expect, it } from "vitest";
import type { HookContext } from "@mantlejs/mantle";
import { attachActor } from "./attach-actor.js";

describe("attachActor()", () => {
  it("stamps the authenticated user's id onto the named field", () => {
    const ctx = { params: { user: { id: 42 } }, data: { body: "hi" } } as unknown as HookContext;
    const result = attachActor("authorId")(ctx) as HookContext;
    expect((result.data as Record<string, unknown>)["authorId"]).toBe(42);
  });

  it("leaves data untouched when there is no authenticated user", () => {
    const ctx = { params: {}, data: { body: "hi" } } as unknown as HookContext;
    const result = attachActor("authorId")(ctx) as HookContext;
    expect((result.data as Record<string, unknown>)["authorId"]).toBeUndefined();
  });
});
