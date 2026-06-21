import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { mantle } from "@mantlejs/core";
import { Unprocessable } from "@mantlejs/core";
import type { HookContext, MantleApplication, Service, Paginated, ServiceParams } from "@mantlejs/core";
import "./formats.js";
import { validate } from "./validate.js";
import { resolver } from "./resolver.js";

const UserSchema = Type.Object({
  id: Type.Optional(Type.String()),
  email: Type.String({ format: "email" }),
  name: Type.String({ minLength: 1 }),
  password: Type.Optional(Type.String()),
});

type User = {
  id?: string;
  email: string;
  name: string;
  password?: string;
};

function makeCtx(overrides: Partial<HookContext<User>> = {}): HookContext<User> {
  const app = mantle();
  return {
    app: app as MantleApplication,
    service: {} as Partial<Service<User>>,
    path: "users",
    method: "create",
    params: {},
    ...overrides,
  };
}

describe("validate()", () => {
  it("passes when data matches the schema", () => {
    const hook = validate(UserSchema);
    const ctx = makeCtx({ data: { email: "alice@example.com", name: "Alice" } });
    expect(() => hook(ctx)).not.toThrow();
  });

  it("throws Unprocessable with field errors on invalid data", () => {
    const hook = validate(UserSchema);
    const ctx = makeCtx({ data: { email: "not-an-email", name: "" } });
    try {
      hook(ctx);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Unprocessable);
      const e = err as Unprocessable;
      expect(e.message).toBe("Validation failed");
      const data = e.data as { errors: { field: string; message: string }[] };
      expect(Array.isArray(data.errors)).toBe(true);
      const fields = data.errors.map((f) => f.field);
      expect(fields).toContain("/email");
      expect(fields).toContain("/name");
    }
  });

  it("validates context.result when target is 'result'", () => {
    const hook = validate(UserSchema, { target: "result" });
    const ctx = makeCtx({ result: { email: "bad", name: "" } as User });
    expect(() => hook(ctx)).toThrow(Unprocessable);
  });

  it("validates context.params.query when target is 'query'", () => {
    const QuerySchema = Type.Object({ limit: Type.Number() });
    const hook = validate(QuerySchema, { target: "query" });
    const ctx = makeCtx({ params: { query: { limit: "not-a-number" } } as ServiceParams });
    expect(() => hook(ctx)).toThrow(Unprocessable);
  });

  it("skips validation when target value is undefined", () => {
    const hook = validate(UserSchema);
    const ctx = makeCtx({ data: undefined });
    expect(() => hook(ctx)).not.toThrow();
  });

  it("coerces values before validation when coerce is true", () => {
    const NumSchema = Type.Object({ count: Type.Number() });
    const hook = validate(NumSchema, { coerce: true });
    const ctx = makeCtx({ data: { count: "42" } as unknown as Partial<User> });
    expect(() => hook(ctx)).not.toThrow();
    expect((ctx.data as unknown as { count: number }).count).toBe(42);
  });

  it("strips additional properties when stripAdditional is true", () => {
    const hook = validate(UserSchema, { stripAdditional: true });
    const ctx = makeCtx({ data: { email: "alice@example.com", name: "Alice", extra: "field" } as Partial<User> & { extra: string } });
    hook(ctx);
    expect((ctx.data as Record<string, unknown>)["extra"]).toBeUndefined();
  });
});

describe("resolver()", () => {
  it("removes a field when resolver returns undefined", async () => {
    const hook = resolver<User>({ password: () => undefined });
    const ctx = makeCtx({ result: { email: "a@b.com", name: "Alice", password: "secret" } });
    await hook(ctx);
    expect((ctx.result as User).password).toBeUndefined();
    expect(Object.keys(ctx.result as User)).not.toContain("password");
  });

  it("transforms a field when resolver returns a new value", async () => {
    const hook = resolver<User>({ name: (v) => (v as string).toUpperCase() });
    const ctx = makeCtx({ result: { email: "a@b.com", name: "Alice" } });
    await hook(ctx);
    expect((ctx.result as User).name).toBe("ALICE");
  });

  it("applies to each element in an array result", async () => {
    const hook = resolver<User>({ password: () => undefined });
    const ctx = makeCtx({
      result: [
        { email: "a@b.com", name: "Alice", password: "secret1" },
        { email: "b@c.com", name: "Bob", password: "secret2" },
      ] as User[],
    });
    await hook(ctx);
    const results = ctx.result as User[];
    expect(results[0].password).toBeUndefined();
    expect(results[1].password).toBeUndefined();
  });

  it("applies to data array of paginated result", async () => {
    const hook = resolver<User>({ password: () => undefined });
    const paginated: Paginated<User> = {
      total: 1,
      limit: 10,
      skip: 0,
      data: [{ email: "a@b.com", name: "Alice", password: "secret" }],
    };
    const ctx = makeCtx({ result: paginated });
    await hook(ctx);
    const p = ctx.result as Paginated<User>;
    expect(p.data[0].password).toBeUndefined();
  });

  it("passes current value, full record, and context to resolver", async () => {
    const calls: unknown[] = [];
    const hook = resolver<User>({
      name: (value, data, context) => {
        calls.push({ value, dataEmail: data.email, path: context.path });
        return value;
      },
    });
    const ctx = makeCtx({ result: { email: "a@b.com", name: "Alice" } });
    await hook(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ value: "Alice", dataEmail: "a@b.com", path: "users" });
  });

  it("returns ctx unchanged when result is undefined", async () => {
    const hook = resolver<User>({ password: () => undefined });
    const ctx = makeCtx({ result: undefined });
    await hook(ctx);
    expect(ctx.result).toBeUndefined();
  });

  it("supports async field resolvers", async () => {
    const hook = resolver<User>({
      name: async (v) => `async-${v as string}`,
    });
    const ctx = makeCtx({ result: { email: "a@b.com", name: "Alice" } });
    await hook(ctx);
    expect((ctx.result as User).name).toBe("async-Alice");
  });
});

describe("re-exports from @sinclair/typebox", () => {
  it("exports Type builder", () => {
    const schema = Type.String();
    expect(schema).toBeDefined();
    expect(schema.type).toBe("string");
  });
});
