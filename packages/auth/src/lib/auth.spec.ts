import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { MantleApplication, HookContext } from "@mantlejs/mantle";
import { BadRequest, NotAuthenticated } from "@mantlejs/mantle";
import { auth } from "./auth.js";
import { authenticate } from "./authenticate.js";
import { sanitizeUser } from "./sanitize-user.js";
import type { AuthEngine, AuthStrategy } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SECRET = "test-secret-key";

function makeApp(overrides: Partial<Record<string, unknown>> = {}): MantleApplication {
  const store = new Map<string, unknown>(Object.entries(overrides));
  const app = {
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return app;
    }),
    get: vi.fn((key: string) => store.get(key)),
    use: vi.fn().mockReturnThis(),
  } as unknown as MantleApplication;
  return app;
}

function makeEngine(secret = SECRET): AuthEngine {
  const app = makeApp();
  auth({ secret })(app);
  return (app as unknown as { get: (k: string) => AuthEngine }).get("auth");
}

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  const app = makeApp();
  const engine = makeEngine();
  (app as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }).set("auth", engine);

  return {
    app,
    service: {},
    path: "users",
    method: "find",
    params: { provider: "rest", headers: {} },
    ...overrides,
  } as HookContext;
}

// ─── auth() plugin ────────────────────────────────────────────────────────────

describe("auth()", () => {
  it("registers the auth engine on the app", () => {
    const app = makeApp();
    auth({ secret: SECRET })(app);
    expect(app.set).toHaveBeenCalledWith("auth", expect.objectContaining({ config: { secret: SECRET } }));
  });

  it("registers an 'authentication' service on the app", () => {
    const app = makeApp();
    auth({ secret: SECRET })(app);
    expect(app.use).toHaveBeenCalledWith(
      "authentication",
      expect.objectContaining({ create: expect.any(Function) }),
      { methods: ["create"] },
    );
  });

  it("authentication service dispatches to a registered strategy", async () => {
    const app = makeApp();
    auth({ secret: SECRET })(app);
    const engine = (app as unknown as { get: (k: string) => AuthEngine }).get("auth");

    const strategy: AuthStrategy = {
      name: "local",
      authenticate: vi.fn().mockResolvedValue({ accessToken: "tok" }),
    };
    engine.registerStrategy(strategy);

    const authServiceCall = (app.use as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "authentication",
    );
    const authService = authServiceCall?.[1] as { create: (data: unknown) => Promise<unknown> };
    const result = await authService.create({ strategy: "local", email: "a@b.com" });
    expect(result).toEqual({ accessToken: "tok" });
  });

  it("authentication service throws BadRequest when strategy field is missing", async () => {
    const app = makeApp();
    auth({ secret: SECRET })(app);
    const authServiceCall = (app.use as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "authentication",
    );
    const authService = authServiceCall?.[1] as { create: (data: unknown) => Promise<unknown> };
    await expect(authService.create({ email: "a@b.com" })).rejects.toBeInstanceOf(BadRequest);
  });

  describe("createJwt / verifyJwt", () => {
    it("creates a token that can be verified with verifyJwt", () => {
      const engine = makeEngine();
      const token = engine.createJwt({ sub: "42" });
      const payload = engine.verifyJwt(token);
      expect(payload.sub).toBe("42");
    });

    it("includes custom claims in the token", () => {
      const engine = makeEngine();
      const token = engine.createJwt({ sub: "1", role: "admin" });
      const payload = engine.verifyJwt(token);
      expect(payload.role).toBe("admin");
    });

    it("applies issuer when configured", () => {
      const app = makeApp();
      auth({ secret: SECRET, issuer: "mantle" })(app);
      const engine = (app as unknown as { get: (k: string) => AuthEngine }).get("auth");
      const token = engine.createJwt({ sub: "1" });
      const payload = engine.verifyJwt(token);
      expect(payload.iss).toBe("mantle");
    });

    it("verifyJwt throws on an invalid token", () => {
      const engine = makeEngine();
      expect(() => engine.verifyJwt("not.a.jwt")).toThrow();
    });

    it("verifyJwt throws on a token signed with a different secret", () => {
      const engine = makeEngine();
      const foreignToken = jwt.sign({ sub: "1" }, "other-secret");
      expect(() => engine.verifyJwt(foreignToken)).toThrow();
    });
  });

  describe("strategy registration", () => {
    it("dispatches to a registered strategy", async () => {
      const engine = makeEngine();
      const strategy: AuthStrategy = {
        name: "local",
        authenticate: vi.fn().mockResolvedValue({ accessToken: "tok" }),
      };
      engine.registerStrategy(strategy);
      const result = await engine.authenticate("local", { email: "a@b.com" }, {});
      expect(strategy.authenticate).toHaveBeenCalledWith({ email: "a@b.com" }, {});
      expect(result).toEqual({ accessToken: "tok" });
    });

    it("throws BadRequest for an unknown strategy", async () => {
      const engine = makeEngine();
      await expect(engine.authenticate("unknown", {}, {})).rejects.toBeInstanceOf(BadRequest);
    });
  });
});

// ─── authenticate() hook ──────────────────────────────────────────────────────

describe("authenticate('jwt')", () => {
  it("sets params.user from a valid Bearer token", async () => {
    const engine = makeEngine();
    const token = engine.createJwt({ sub: "99", role: "user" });
    const ctx = makeCtx({ params: { provider: "rest", headers: { authorization: `Bearer ${token}` } } });
    (ctx.app as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }).set("auth", engine);

    const result = await authenticate("jwt")(ctx);
    expect((result.params.user as { sub: string }).sub).toBe("99");
  });

  it("accepts Authorization header with capital A", async () => {
    const engine = makeEngine();
    const token = engine.createJwt({ sub: "1" });
    const ctx = makeCtx({ params: { provider: "rest", headers: { Authorization: `Bearer ${token}` } } });
    (ctx.app as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }).set("auth", engine);

    const result = await authenticate("jwt")(ctx);
    expect((result.params.user as { sub: string }).sub).toBe("1");
  });

  it("skips and returns context unchanged for internal calls (no provider)", async () => {
    const ctx = makeCtx({ params: { headers: {} } });
    const result = await authenticate("jwt")(ctx);
    expect(result).toBe(ctx);
    expect(result.params.user).toBeUndefined();
  });

  it("throws NotAuthenticated when no authorization header is present", async () => {
    const ctx = makeCtx({ params: { provider: "rest", headers: {} } });
    await expect(authenticate("jwt")(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated for a non-Bearer scheme", async () => {
    const ctx = makeCtx({ params: { provider: "rest", headers: { authorization: "Basic dXNlcjpwYXNz" } } });
    await expect(authenticate("jwt")(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated for a malformed header (no token after Bearer)", async () => {
    const ctx = makeCtx({ params: { provider: "rest", headers: { authorization: "Bearer" } } });
    await expect(authenticate("jwt")(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated for an expired/invalid token", async () => {
    const expiredToken = jwt.sign({ sub: "1" }, SECRET, { expiresIn: -1 });
    const ctx = makeCtx({ params: { provider: "rest", headers: { authorization: `Bearer ${expiredToken}` } } });
    await expect(authenticate("jwt")(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated when auth plugin is not configured", async () => {
    const ctx = makeCtx({ params: { provider: "rest", headers: { authorization: "Bearer sometoken" } } });
    (ctx.app.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    await expect(authenticate("jwt")(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });
});

describe("authenticate(strategy)", () => {
  it("delegates to the auth engine for external calls", async () => {
    const engine = makeEngine();
    const strategy: AuthStrategy = {
      name: "local",
      authenticate: vi.fn().mockResolvedValue({ accessToken: "tok", userId: "1" }),
    };
    engine.registerStrategy(strategy);

    const ctx = makeCtx({ params: { provider: "rest", headers: {} }, data: { email: "a@b.com", password: "s" } });
    (ctx.app as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void }).set("auth", engine);

    const result = await authenticate("local")(ctx);
    expect(result.params.user).toEqual({ accessToken: "tok", userId: "1" });
  });

  it("skips for internal calls (no provider)", async () => {
    const ctx = makeCtx({ params: { headers: {} }, data: { email: "a@b.com" } });
    const result = await authenticate("local")(ctx);
    expect(result).toBe(ctx);
    expect(result.params.user).toBeUndefined();
  });
});

// ─── sanitizeUser() hook ──────────────────────────────────────────────────────

describe("sanitizeUser()", () => {
  function makeHookCtx(result: unknown): HookContext {
    return { result } as unknown as HookContext;
  }

  it("strips password from a single result object", () => {
    const ctx = makeHookCtx({ id: 1, name: "Alice", password: "hash" });
    const result = sanitizeUser()(ctx) as HookContext;
    expect(result.result).toEqual({ id: 1, name: "Alice" });
    expect(result.result).not.toHaveProperty("password");
  });

  it("strips password from an array result", () => {
    const ctx = makeHookCtx([
      { id: 1, name: "Alice", password: "h1" },
      { id: 2, name: "Bob", password: "h2" },
    ]);
    const result = sanitizeUser()(ctx) as HookContext;
    expect(result.result).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("strips password from a paginated result", () => {
    const ctx = makeHookCtx({ total: 1, limit: 10, skip: 0, data: [{ id: 1, name: "Alice", password: "hash" }] });
    const result = sanitizeUser()(ctx) as HookContext;
    expect((result.result as { data: unknown[] }).data).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("strips passwordHash in addition to password by default", () => {
    const ctx = makeHookCtx({ id: 1, name: "Alice", passwordHash: "argon2hash" });
    const result = sanitizeUser()(ctx) as HookContext;
    expect(result.result).not.toHaveProperty("passwordHash");
  });

  it("respects a custom fields list", () => {
    const ctx = makeHookCtx({ id: 1, name: "Alice", secret: "shh", token: "abc" });
    const result = sanitizeUser(["secret", "token"])(ctx) as HookContext;
    expect(result.result).toEqual({ id: 1, name: "Alice" });
  });

  it("passes through when result is undefined", () => {
    const ctx = makeHookCtx(undefined);
    const result = sanitizeUser()(ctx) as HookContext;
    expect(result.result).toBeUndefined();
  });
});
