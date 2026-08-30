import { describe, expect, it } from "vitest";
import type { HookContext } from "@mantlejs/mantle";
import { Unprocessable } from "@mantlejs/mantle";
import { validate } from "@mantlejs/schema";
import { articleCreateSchema, commentCreateSchema, userCreateSchema } from "./schemas.js";

function makeCtx(data: unknown): HookContext {
  return { data, params: {} } as unknown as HookContext;
}

describe("articleCreateSchema", () => {
  it("accepts a valid article payload", () => {
    const ctx = makeCtx({ title: "Onboarding", body: "Welcome" });
    expect(() => validate(articleCreateSchema)(ctx)).not.toThrow();
  });

  it("rejects a missing title", () => {
    const ctx = makeCtx({ body: "Welcome" });
    expect(() => validate(articleCreateSchema)(ctx)).toThrow(Unprocessable);
  });

  it("rejects an empty body", () => {
    const ctx = makeCtx({ title: "Onboarding", body: "" });
    expect(() => validate(articleCreateSchema)(ctx)).toThrow(Unprocessable);
  });
});

describe("commentCreateSchema", () => {
  it("rejects a non-integer articleId", () => {
    const ctx = makeCtx({ articleId: "not-a-number", body: "nice!" });
    expect(() => validate(commentCreateSchema)(ctx)).toThrow(Unprocessable);
  });
});

describe("userCreateSchema", () => {
  it("accepts an OAuth-created user with no password", () => {
    const ctx = makeCtx({ googleId: "abc123", email: "ada@example.com", name: "Ada" });
    expect(() => validate(userCreateSchema)(ctx)).not.toThrow();
  });

  it("rejects a malformed email", () => {
    const ctx = makeCtx({ email: "not-an-email", password: "s3cretpass" });
    expect(() => validate(userCreateSchema)(ctx)).toThrow(Unprocessable);
  });

  it("rejects a too-short password", () => {
    const ctx = makeCtx({ email: "ada@example.com", password: "short" });
    expect(() => validate(userCreateSchema)(ctx)).toThrow(Unprocessable);
  });
});
