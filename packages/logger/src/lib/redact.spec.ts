import { redactPaths, SENSITIVE_PATHS } from "./redact.js";

describe("redactPaths()", () => {
  it("redacts a bare key only at the top level", () => {
    const input = { password: "secret", nested: { password: "also-secret" } };
    const result = redactPaths(input, ["password"]) as Record<string, unknown>;
    expect(result["password"]).toBe("[Redacted]");
    expect((result["nested"] as Record<string, unknown>)["password"]).toBe("also-secret");
  });

  it("redacts a `*.key` pattern at any depth", () => {
    const input = { accessToken: "a", user: { accessToken: "b", deep: { accessToken: "c" } } };
    const result = redactPaths(input, ["*.accessToken"]) as Record<string, unknown>;
    expect(result["accessToken"]).toBe("[Redacted]");
    const user = result["user"] as Record<string, unknown>;
    expect(user["accessToken"]).toBe("[Redacted]");
    expect((user["deep"] as Record<string, unknown>)["accessToken"]).toBe("[Redacted]");
  });

  it("redacts every SENSITIVE_PATHS entry", () => {
    const input = {
      password: "1",
      query: {
        password: "2",
        accessToken: "3",
        refreshToken: "4",
        authorization: "5",
        cookie: "6",
        safe: "kept",
      },
    };
    const result = redactPaths(input) as Record<string, unknown>;
    const query = result["query"] as Record<string, unknown>;
    expect(result["password"]).toBe("[Redacted]");
    expect(query["password"]).toBe("[Redacted]");
    expect(query["accessToken"]).toBe("[Redacted]");
    expect(query["refreshToken"]).toBe("[Redacted]");
    expect(query["authorization"]).toBe("[Redacted]");
    expect(query["cookie"]).toBe("[Redacted]");
    expect(query["safe"]).toBe("kept");
  });

  it("returns the value unchanged when paths is an empty array", () => {
    const input = { password: "secret" };
    expect(redactPaths(input, [])).toBe(input);
  });

  it("uses SENSITIVE_PATHS as the default", () => {
    const result = redactPaths({ password: "secret" }) as Record<string, unknown>;
    expect(result["password"]).toBe("[Redacted]");
    expect(SENSITIVE_PATHS).toContain("password");
  });

  it("walks arrays", () => {
    const input = { users: [{ password: "1" }, { password: "2" }] };
    const result = redactPaths(input, ["*.password"]) as Record<string, unknown>;
    const users = result["users"] as Record<string, unknown>[];
    expect(users[0]?.["password"]).toBe("[Redacted]");
    expect(users[1]?.["password"]).toBe("[Redacted]");
  });

  it("passes through primitives and null", () => {
    expect(redactPaths("hello")).toBe("hello");
    expect(redactPaths(42)).toBe(42);
    expect(redactPaths(null)).toBe(null);
    expect(redactPaths(undefined)).toBe(undefined);
  });

  it("does not mutate the original object", () => {
    const input = { password: "secret" };
    redactPaths(input, ["password"]);
    expect(input.password).toBe("secret");
  });
});
