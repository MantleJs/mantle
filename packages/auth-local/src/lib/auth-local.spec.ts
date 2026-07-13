import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MantleApplication, HookContext } from "@mantlejs/mantle";
import { NotAuthenticated } from "@mantlejs/mantle";
import type { AuthEngine, AuthStrategy } from "@mantlejs/auth";

const mockHash = vi.fn();
const mockVerify = vi.fn();

vi.mock("@node-rs/argon2", () => ({
  hash: mockHash,
  verify: mockVerify,
}));

// Imports must follow the mock declaration so vitest hoists correctly
const { localStrategy } = await import("./auth-local.js");
const { hashPassword } = await import("./hash-password.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEngine(overrides: Partial<AuthEngine> = {}): AuthEngine {
  return {
    config: { secret: "test" },
    createJwt: vi.fn().mockReturnValue("mock.jwt.token"),
    verifyJwt: vi.fn(),
    createTokenPair: vi
      .fn()
      .mockResolvedValue({ accessToken: "mock.jwt.token", refreshToken: "mock.refresh.token" }),
    registerStrategy: vi.fn(),
    authenticate: vi.fn(),
    ...overrides,
  };
}

function makeApp(engine?: AuthEngine, findResult: unknown = []): MantleApplication {
  const store = new Map<string, unknown>([["auth", engine]]);
  const serviceMock = { find: vi.fn().mockResolvedValue(findResult) };
  const app = {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: unknown) => { store.set(key, value); return app; }),
    use: vi.fn().mockReturnThis(),
    service: vi.fn().mockReturnValue(serviceMock),
    _serviceMock: serviceMock,
  } as unknown as MantleApplication;
  return app;
}

function captureStrategy(app: MantleApplication): AuthStrategy {
  const engine = (app as unknown as { get: (k: string) => AuthEngine }).get("auth");
  const call = (engine.registerStrategy as ReturnType<typeof vi.fn>).mock.calls[0];
  return call?.[0] as AuthStrategy;
}

// ─── localStrategy() plugin ───────────────────────────────────────────────────

describe("localStrategy()", () => {
  beforeEach(() => {
    mockVerify.mockResolvedValue(true);
  });

  it("throws if auth engine is not configured", () => {
    const app = makeApp(undefined);
    expect(() => localStrategy()(app)).toThrow("@mantlejs/auth must be configured before @mantlejs/auth-local");
  });

  it("registers a 'local' strategy with the auth engine", () => {
    const engine = makeEngine();
    const app = makeApp(engine);
    localStrategy()(app);
    expect(engine.registerStrategy).toHaveBeenCalledWith(expect.objectContaining({ name: "local" }));
  });

  describe("strategy.authenticate", () => {
    const STORED_HASH = "$argon2id$v=19$m=65536$hashed";

    it("returns accessToken and user on valid credentials", async () => {
      const user = { id: 1, email: "alice@example.com", password: STORED_HASH };
      const engine = makeEngine();
      const app = makeApp(engine, [user]);
      localStrategy()(app);
      const strategy = captureStrategy(app);

      const result = await strategy.authenticate({ email: "alice@example.com", password: "secret" }, {});

      expect(mockVerify).toHaveBeenCalledWith(STORED_HASH, "secret");
      expect(result.accessToken).toBe("mock.jwt.token");
      expect(result["refreshToken"]).toBe("mock.refresh.token");
      expect(result.user).toEqual(user);
    });

    it("creates the token pair with sub set to the user id", async () => {
      const user = { id: 42, email: "bob@example.com", password: STORED_HASH };
      const engine = makeEngine();
      const app = makeApp(engine, [user]);
      localStrategy()(app);
      const strategy = captureStrategy(app);

      await strategy.authenticate({ email: "bob@example.com", password: "pw" }, {});

      expect(engine.createTokenPair).toHaveBeenCalledWith("42");
    });

    it("handles paginated find results", async () => {
      const user = { id: 1, email: "alice@example.com", password: STORED_HASH };
      const engine = makeEngine();
      const app = makeApp(engine, { total: 1, limit: 10, skip: 0, data: [user] });
      localStrategy()(app);
      const strategy = captureStrategy(app);

      const result = await strategy.authenticate({ email: "alice@example.com", password: "secret" }, {});
      expect(result.user).toEqual(user);
    });

    it("throws NotAuthenticated when user is not found", async () => {
      const engine = makeEngine();
      const app = makeApp(engine, []);
      localStrategy()(app);
      const strategy = captureStrategy(app);

      await expect(strategy.authenticate({ email: "nobody@example.com", password: "pw" }, {})).rejects.toBeInstanceOf(
        NotAuthenticated,
      );
    });

    it("throws NotAuthenticated when password is wrong", async () => {
      mockVerify.mockResolvedValue(false);
      const user = { id: 1, email: "alice@example.com", password: STORED_HASH };
      const engine = makeEngine();
      const app = makeApp(engine, [user]);
      localStrategy()(app);
      const strategy = captureStrategy(app);

      await expect(
        strategy.authenticate({ email: "alice@example.com", password: "wrong" }, {}),
      ).rejects.toBeInstanceOf(NotAuthenticated);
    });

    it("throws NotAuthenticated when find throws", async () => {
      const engine = makeEngine();
      const app = makeApp(engine);
      (app.service("users") as unknown as { find: ReturnType<typeof vi.fn> }).find.mockRejectedValue(new Error("DB error"));
      localStrategy()(app);
      const strategy = captureStrategy(app);

      await expect(strategy.authenticate({ email: "alice@example.com", password: "pw" }, {})).rejects.toBeInstanceOf(
        NotAuthenticated,
      );
    });

    it("throws NotAuthenticated when credentials are missing", async () => {
      const engine = makeEngine();
      const app = makeApp(engine);
      localStrategy()(app);
      const strategy = captureStrategy(app);

      await expect(strategy.authenticate({}, {})).rejects.toBeInstanceOf(NotAuthenticated);
      await expect(strategy.authenticate({ email: "a@b.com" }, {})).rejects.toBeInstanceOf(NotAuthenticated);
      await expect(strategy.authenticate({ password: "pw" }, {})).rejects.toBeInstanceOf(NotAuthenticated);
    });

    it("uses custom usernameField and passwordField", async () => {
      const user = { id: 1, username: "alice", secret: STORED_HASH };
      const engine = makeEngine();
      const app = makeApp(engine, [user]);
      localStrategy({ usernameField: "username", passwordField: "secret" })(app);
      const strategy = captureStrategy(app);

      const result = await strategy.authenticate({ username: "alice", secret: "pw" }, {});
      expect(result.user).toEqual(user);
      expect(app.service).toHaveBeenCalledWith("users");
    });

    it("uses custom entityService", async () => {
      const user = { id: 1, email: "alice@example.com", password: STORED_HASH };
      const engine = makeEngine();
      const app = makeApp(engine, [user]);
      localStrategy({ entityService: "accounts" })(app);
      const strategy = captureStrategy(app);

      await strategy.authenticate({ email: "alice@example.com", password: "pw" }, {});
      expect(app.service).toHaveBeenCalledWith("accounts");
    });

    it("falls back to _id when id is not present", async () => {
      const user = { _id: "abc123", email: "alice@example.com", password: STORED_HASH };
      const engine = makeEngine();
      const app = makeApp(engine, [user]);
      localStrategy()(app);
      const strategy = captureStrategy(app);

      await strategy.authenticate({ email: "alice@example.com", password: "pw" }, {});
      expect(engine.createTokenPair).toHaveBeenCalledWith("abc123");
    });
  });
});

// ─── hashPassword() hook ──────────────────────────────────────────────────────

describe("hashPassword()", () => {
  beforeEach(() => {
    mockHash.mockClear();
    mockHash.mockResolvedValue("$argon2id$hashed");
  });

  function makeCtx(data: unknown): HookContext {
    return { data, params: {} } as unknown as HookContext;
  }

  it("replaces the password field with an argon2 hash", async () => {
    const ctx = makeCtx({ name: "Alice", password: "secret" });
    const result = await hashPassword()(ctx);
    expect(mockHash).toHaveBeenCalledWith("secret");
    expect((result.data as Record<string, unknown>)["password"]).toBe("$argon2id$hashed");
  });

  it("hashes a custom field name", async () => {
    const ctx = makeCtx({ secret: "plaintext" });
    const result = await hashPassword("secret")(ctx);
    expect((result.data as Record<string, unknown>)["secret"]).toBe("$argon2id$hashed");
  });

  it("skips when the field is absent", async () => {
    const ctx = makeCtx({ name: "Alice" });
    await hashPassword()(ctx);
    expect(mockHash).not.toHaveBeenCalled();
  });

  it("skips when the field value is not a string", async () => {
    const ctx = makeCtx({ password: 12345 });
    await hashPassword()(ctx);
    expect(mockHash).not.toHaveBeenCalled();
  });

  it("skips when context.data is undefined", async () => {
    const ctx = makeCtx(undefined);
    await hashPassword()(ctx);
    expect(mockHash).not.toHaveBeenCalled();
  });

  it("returns context unchanged when nothing to hash", async () => {
    const ctx = makeCtx({ name: "Alice" });
    const result = await hashPassword()(ctx);
    expect(result).toBe(ctx);
  });
});
