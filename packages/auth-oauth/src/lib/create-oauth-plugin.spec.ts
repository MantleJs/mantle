import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MantleApplication } from "@mantlejs/core";
import { NotAuthenticated } from "@mantlejs/core";
import type { AuthEngine } from "@mantlejs/auth";
import type { OAuthProvider } from "./types.js";

const mockStateStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  cleanup: vi.fn(),
};

vi.mock("./pkce.js", () => ({
  generateState: vi.fn().mockReturnValue("fixed-state"),
  generateCodeVerifier: vi.fn().mockReturnValue("fixed-verifier"),
  generateCodeChallenge: vi.fn().mockReturnValue("fixed-challenge"),
}));

vi.mock("./state-store.js", () => ({
  createStateStore: vi.fn(() => mockStateStore),
}));

vi.mock("./find-or-create.js", () => ({
  findOrCreateUser: vi.fn(),
}));

const { createOAuthPlugin } = await import("./create-oauth-plugin.js");
const { findOrCreateUser } = await import("./find-or-create.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RouteHandler = (req: MockReq, res: MockRes, next: (err?: unknown) => void) => void | Promise<void>;

interface MockReq {
  protocol: string;
  query: Record<string, string | undefined>;
  get(header: string): string | undefined;
}

interface MockRes {
  redirect: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function makeRouter() {
  const routes = new Map<string, RouteHandler>();
  return {
    get: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(path, handler);
    }),
    route: (path: string) => routes.get(path)!,
  };
}

function makeReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    protocol: "https",
    query: {},
    get: vi.fn((h: string) => (h === "host" ? "example.com" : undefined)),
    ...overrides,
  };
}

function makeRes(): MockRes {
  return { redirect: vi.fn(), json: vi.fn() };
}

function makeEngine(overrides: Partial<AuthEngine> = {}): AuthEngine {
  return {
    config: { secret: "test" },
    createJwt: vi.fn().mockReturnValue("mantle.jwt.token"),
    verifyJwt: vi.fn(),
    registerStrategy: vi.fn(),
    authenticate: vi.fn(),
    ...overrides,
  };
}

function makeApp(engine?: AuthEngine, router?: ReturnType<typeof makeRouter>): MantleApplication {
  const store = new Map<string, unknown>([
    ["auth", engine],
    ["express", router],
  ]);
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn(),
    use: vi.fn().mockReturnThis(),
    service: vi.fn(),
  } as unknown as MantleApplication;
}

function makeProvider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    usePkce: true,
    defaultScope: ["openid", "profile", "email"],
    buildAuthUrl: vi.fn().mockReturnValue("https://provider.example.com/auth"),
    exchangeCode: vi.fn().mockResolvedValue("provider-access-token"),
    fetchProfile: vi.fn().mockResolvedValue({ id: "uid123", email: "alice@example.com", name: "Alice" }),
    ...overrides,
  };
}

const BASE_CONFIG = { clientId: "cid", clientSecret: "csecret" };
const EXISTING_USER = { id: "1", testId: "uid123", email: "alice@example.com" };
const PENDING_STATE = { codeVerifier: "fixed-verifier", expiresAt: Date.now() + 60_000 };

// ─── Plugin initialization ────────────────────────────────────────────────────

describe("createOAuthPlugin()", () => {
  beforeEach(() => {
    vi.mocked(findOrCreateUser).mockResolvedValue(EXISTING_USER);
    mockStateStore.get.mockReturnValue(PENDING_STATE);
    mockStateStore.set.mockReset();
    mockStateStore.cleanup.mockReset();
    mockStateStore.delete.mockReset();
  });

  it("throws if auth engine is not configured", () => {
    const router = makeRouter();
    const app = makeApp(undefined, router);
    expect(() => createOAuthPlugin("test", makeProvider(), BASE_CONFIG)(app)).toThrow(
      "@mantlejs/auth must be configured before @mantlejs/auth-test",
    );
  });

  it("throws if express is not configured", () => {
    const app = makeApp(makeEngine(), undefined);
    expect(() => createOAuthPlugin("test", makeProvider(), BASE_CONFIG)(app)).toThrow(
      "@mantlejs/express must be configured before @mantlejs/auth-test",
    );
  });

  it("registers redirect and callback routes on the express router", () => {
    const router = makeRouter();
    const app = makeApp(makeEngine(), router);
    createOAuthPlugin("test", makeProvider(), BASE_CONFIG)(app);
    expect(router.get).toHaveBeenCalledWith("/auth/test", expect.any(Function));
    expect(router.get).toHaveBeenCalledWith("/auth/test/callback", expect.any(Function));
  });

  it("uses a custom callbackUrl for route registration", () => {
    const router = makeRouter();
    const app = makeApp(makeEngine(), router);
    createOAuthPlugin("test", makeProvider(), { ...BASE_CONFIG, callbackUrl: "/custom/cb" })(app);
    expect(router.get).toHaveBeenCalledWith("/custom/cb", expect.any(Function));
  });

  // ─── Redirect route ─────────────────────────────────────────────────────────

  describe("GET /auth/{providerKey}", () => {
    it("cleans up stale state entries on each request", () => {
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", makeProvider(), BASE_CONFIG)(app);
      const handler = router.route("/auth/test");
      handler(makeReq(), makeRes(), vi.fn());
      expect(mockStateStore.cleanup).toHaveBeenCalledOnce();
    });

    it("generates state, stores it, and redirects to provider URL", () => {
      const provider = makeProvider();
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", provider, BASE_CONFIG)(app);
      const res = makeRes();
      router.route("/auth/test")(makeReq(), res, vi.fn());

      expect(mockStateStore.set).toHaveBeenCalledWith("fixed-state", { codeVerifier: "fixed-verifier" });
      expect(res.redirect).toHaveBeenCalledWith("https://provider.example.com/auth");
    });

    it("passes PKCE challenge to buildAuthUrl when usePkce is true", () => {
      const provider = makeProvider({ usePkce: true });
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", provider, BASE_CONFIG)(app);
      router.route("/auth/test")(makeReq(), makeRes(), vi.fn());

      expect(provider.buildAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({ codeChallenge: "fixed-challenge" }),
      );
    });

    it("does not include codeChallenge when usePkce is false", () => {
      const provider = makeProvider({ usePkce: false });
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", provider, BASE_CONFIG)(app);
      router.route("/auth/test")(makeReq(), makeRes(), vi.fn());

      expect(provider.buildAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({ codeChallenge: undefined }),
      );
    });

    it("constructs redirectUri from request protocol and host", () => {
      const provider = makeProvider();
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", provider, BASE_CONFIG)(app);
      const req = makeReq({ protocol: "http", get: vi.fn((h) => (h === "host" ? "localhost:3000" : undefined)) });
      router.route("/auth/test")(req, makeRes(), vi.fn());

      expect(provider.buildAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({ redirectUri: "http://localhost:3000/auth/test/callback" }),
      );
    });

    it("uses custom scope when provided", () => {
      const provider = makeProvider();
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", provider, { ...BASE_CONFIG, scope: ["custom"] })(app);
      router.route("/auth/test")(makeReq(), makeRes(), vi.fn());

      expect(provider.buildAuthUrl).toHaveBeenCalledWith(expect.objectContaining({ scope: ["custom"] }));
    });
  });

  // ─── Callback route ──────────────────────────────────────────────────────────

  describe("GET /auth/{providerKey}/callback", () => {
    async function invokeCallback(
      options: {
        query?: Record<string, string | undefined>;
        engine?: AuthEngine;
        provider?: OAuthProvider;
        config?: Partial<typeof BASE_CONFIG>;
      } = {},
    ) {
      const provider = options.provider ?? makeProvider();
      const engine = options.engine ?? makeEngine();
      const router = makeRouter();
      const app = makeApp(engine, router);
      createOAuthPlugin("test", provider, { ...BASE_CONFIG, ...options.config })(app);

      const req = makeReq({ query: { code: "auth-code", state: "fixed-state", ...options.query } });
      const res = makeRes();
      const next = vi.fn();
      await router.route("/auth/test/callback")(req, res, next);
      return { res, next, engine, provider, app };
    }

    it("throws NotAuthenticated when provider returns an error param", async () => {
      const { next } = await invokeCallback({ query: { error: "access_denied", code: undefined, state: undefined } });
      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticated));
    });

    it("throws NotAuthenticated when code is missing", async () => {
      const { next } = await invokeCallback({ query: { code: undefined, state: "fixed-state" } });
      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticated));
    });

    it("throws NotAuthenticated when state is missing", async () => {
      const { next } = await invokeCallback({ query: { code: "auth-code", state: undefined } });
      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticated));
    });

    it("throws NotAuthenticated when state is invalid or expired", async () => {
      mockStateStore.get.mockReturnValueOnce(undefined);
      const { next } = await invokeCallback();
      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticated));
    });

    it("deletes state from store after reading it", async () => {
      await invokeCallback();
      expect(mockStateStore.delete).toHaveBeenCalledWith("fixed-state");
    });

    it("exchanges code with codeVerifier from state store", async () => {
      const { provider } = await invokeCallback();
      expect(provider.exchangeCode).toHaveBeenCalledWith(
        expect.objectContaining({ code: "auth-code", codeVerifier: "fixed-verifier" }),
      );
    });

    it("fetches profile using the provider access token", async () => {
      const { provider } = await invokeCallback();
      expect(provider.fetchProfile).toHaveBeenCalledWith("provider-access-token");
    });

    it("calls findOrCreateUser with app, entity, entityIdField, and profile", async () => {
      const { app } = await invokeCallback();
      expect(findOrCreateUser).toHaveBeenCalledWith(
        app,
        "users",
        "testId",
        { id: "uid123", email: "alice@example.com", name: "Alice" },
      );
    });

    it("returns accessToken, refreshToken, and user on success", async () => {
      const { res } = await invokeCallback();
      expect(res.json).toHaveBeenCalledWith({
        accessToken: "mantle.jwt.token",
        refreshToken: "mantle.jwt.token",
        user: EXISTING_USER,
      });
    });

    it("creates both access and refresh JWTs with sub set to user id", async () => {
      const { engine } = await invokeCallback();
      expect(engine.createJwt).toHaveBeenCalledWith({ sub: "1" });
      expect(engine.createJwt).toHaveBeenCalledWith({ sub: "1", type: "refresh" });
    });

    it("falls back to _id when id is not present on the user", async () => {
      vi.mocked(findOrCreateUser).mockResolvedValueOnce({ _id: "mongo-id", testId: "uid123" });
      const { engine } = await invokeCallback();
      expect(engine.createJwt).toHaveBeenCalledWith({ sub: "mongo-id" });
    });

    it("handles paginated find results via findOrCreateUser", async () => {
      vi.mocked(findOrCreateUser).mockResolvedValueOnce({ id: "99", testId: "uid123" });
      const { res } = await invokeCallback();
      expect((res.json.mock.calls[0][0] as Record<string, unknown>)["user"]).toMatchObject({ id: "99" });
    });

    it("propagates errors from exchangeCode to next()", async () => {
      const provider = makeProvider({ exchangeCode: vi.fn().mockRejectedValue(new Error("network")) });
      const { next } = await invokeCallback({ provider });
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("propagates errors from fetchProfile to next()", async () => {
      const provider = makeProvider({ fetchProfile: vi.fn().mockRejectedValue(new Error("profile fail")) });
      const { next } = await invokeCallback({ provider });
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("propagates errors from findOrCreateUser to next()", async () => {
      vi.mocked(findOrCreateUser).mockRejectedValueOnce(new Error("db error"));
      const { next } = await invokeCallback();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("uses custom callbackPath in redirectUri sent to exchangeCode", async () => {
      const provider = makeProvider();
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", provider, { ...BASE_CONFIG, callbackUrl: "/custom/cb" })(app);
      const req = makeReq({ query: { code: "auth-code", state: "fixed-state" } });
      await router.route("/custom/cb")(req, makeRes(), vi.fn());

      expect(provider.exchangeCode).toHaveBeenCalledWith(
        expect.objectContaining({ redirectUri: "https://example.com/custom/cb" }),
      );
    });

    it("uses custom entity and entityIdField", async () => {
      const router = makeRouter();
      const app = makeApp(makeEngine(), router);
      createOAuthPlugin("test", makeProvider(), { ...BASE_CONFIG, entity: "accounts", entityIdField: "oauthId" })(app);
      const req = makeReq({ query: { code: "auth-code", state: "fixed-state" } });
      await router.route("/auth/test/callback")(req, makeRes(), vi.fn());

      expect(findOrCreateUser).toHaveBeenCalledWith(app, "accounts", "oauthId", expect.anything());
    });
  });
});
