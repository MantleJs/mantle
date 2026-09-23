import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { HookContext, MantleApplication } from "@mantlejs/mantle";
import { Forbidden, NotAuthenticated } from "@mantlejs/mantle";
import { auth } from "./auth.js";
import { authenticate } from "./authenticate.js";
import { authorizeAgent } from "./agent.js";
import type { AuthEngine } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SECRET = "test-secret-key";

function makeApp(): MantleApplication {
  const store = new Map<string, unknown>();
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

function makeEngine(secret = SECRET): { app: MantleApplication; engine: AuthEngine } {
  const app = makeApp();
  auth({ secret })(app);
  const engine = (app as unknown as { get: (k: string) => AuthEngine }).get("auth");
  return { app, engine };
}

function makeCtx(app: MantleApplication, overrides: Partial<HookContext> = {}): HookContext {
  return {
    app,
    service: {},
    path: "articles",
    method: "find",
    params: { provider: "rest", headers: {} },
    ...overrides,
  } as HookContext;
}

// ─── engine.issueAgentToken / revokeAgentToken / isAgentTokenValid ────────────

describe("engine.issueAgentToken()", () => {
  it("round-trips the capability scope and delegatingUserId through the signed token", async () => {
    const { engine } = makeEngine();
    const scope = { articles: ["find", "get"] };
    const issued = await engine.issueAgentToken(scope, "user-1");

    const payload = engine.verifyJwt(issued.accessToken);
    expect(payload["type"]).toBe("agent");
    expect(payload["scope"]).toEqual(scope);
    expect(payload["delegatingUserId"]).toBe("user-1");
    expect(payload.sub).toBe(issued.id);
  });

  it("defaults to a 15 minute expiry", async () => {
    const { engine } = makeEngine();
    const before = Math.floor(Date.now() / 1000);
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");
    expect(issued.expiresAt).toBeGreaterThan(before + 14 * 60);
    expect(issued.expiresAt).toBeLessThanOrEqual(before + 15 * 60 + 5);
  });

  it("honors a custom expiresIn and enforces it", async () => {
    const { engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1", { expiresIn: -1 });
    expect(() => engine.verifyJwt(issued.accessToken)).toThrow();
  });

  it("records the issued token so isAgentTokenValid() is true immediately after issuance", async () => {
    const { engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");
    expect(await engine.isAgentTokenValid(issued.id)).toBe(true);
  });
});

describe("engine.revokeAgentToken()", () => {
  it("makes a previously-issued token invalid without touching its JWT signature", async () => {
    const { engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");

    await engine.revokeAgentToken(issued.id);

    expect(await engine.isAgentTokenValid(issued.id)).toBe(false);
    // The JWT itself still verifies — revocation is enforced by authorizeAgent()'s store check,
    // not by the JWT becoming cryptographically invalid.
    expect(() => engine.verifyJwt(issued.accessToken)).not.toThrow();
  });
});

// ─── authorizeAgent() ──────────────────────────────────────────────────────────

describe("authorizeAgent()", () => {
  it("skips and returns context unchanged for internal calls (no provider)", async () => {
    const { app } = makeEngine();
    const ctx = makeCtx(app, { params: { headers: {} } });
    const result = await authorizeAgent()(ctx);
    expect(result).toBe(ctx);
    expect(result.agent).toBeUndefined();
  });

  it("populates HookContext.agent and allows an in-scope call", async () => {
    const { app, engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: ["find"] }, "user-1");
    const ctx = makeCtx(app, {
      method: "find",
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    const result = await authorizeAgent()(ctx);

    expect(result.agent).toEqual({ id: issued.id, scope: { articles: ["find"] }, delegatingUserId: "user-1" });
    expect(result.params.user).toBeUndefined(); // additive — never touches params.user
  });

  it("allows every method under a path-level wildcard scope", async () => {
    const { app, engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");
    const ctx = makeCtx(app, {
      method: "remove",
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    const result = await authorizeAgent()(ctx);
    expect(result.agent?.id).toBe(issued.id);
  });

  it("throws Forbidden for an out-of-scope method on an in-scope path", async () => {
    const { app, engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: ["find"] }, "user-1");
    const ctx = makeCtx(app, {
      method: "remove",
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    await expect(authorizeAgent()(ctx)).rejects.toBeInstanceOf(Forbidden);
  });

  it("throws Forbidden for a path entirely absent from the scope", async () => {
    const { app, engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");
    const ctx = makeCtx(app, {
      path: "users",
      method: "find",
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    await expect(authorizeAgent()(ctx)).rejects.toBeInstanceOf(Forbidden);
  });

  it("throws NotAuthenticated once the token has been revoked", async () => {
    const { app, engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");
    await engine.revokeAgentToken(issued.id);
    const ctx = makeCtx(app, {
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    await expect(authorizeAgent()(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated when no authorization header is present", async () => {
    const { app } = makeEngine();
    const ctx = makeCtx(app);
    await expect(authorizeAgent()(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated for an expired token", async () => {
    const { app, engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1", { expiresIn: -1 });
    const ctx = makeCtx(app, {
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    await expect(authorizeAgent()(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated for a well-formed user JWT (not an agent token)", async () => {
    const { app, engine } = makeEngine();
    const userToken = engine.createJwt({ sub: "user-1" });
    const ctx = makeCtx(app, {
      params: { provider: "rest", headers: { authorization: `Bearer ${userToken}` } },
    });

    await expect(authorizeAgent()(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("throws NotAuthenticated when auth plugin is not configured", async () => {
    const { app } = makeEngine();
    const ctx = makeCtx(app, {
      params: { provider: "rest", headers: { authorization: "Bearer sometoken" } },
    });
    (app.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await expect(authorizeAgent()(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });
});

// ─── Opt-in per route: an agent token is not a substitute for a user JWT ──────

describe("agent tokens are opt-in per route", () => {
  it("authenticate('jwt') rejects an agent token outright, even though it verifies", async () => {
    const { app, engine } = makeEngine();
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");
    const ctx = makeCtx(app, {
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    // Sanity: the token is a perfectly valid JWT signed with the right secret.
    expect(() => jwt.verify(issued.accessToken, SECRET)).not.toThrow();

    // But a route with only authenticate("jwt") — no authorizeAgent() — must never accept it.
    await expect(authenticate("jwt")(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("a route with no authorizeAgent() hook can never be reached with an agent token, regardless of scope", async () => {
    const { app, engine } = makeEngine();
    // A maximally-privileged agent token — wildcard scope on the exact path/method under test.
    const issued = await engine.issueAgentToken({ articles: true }, "user-1");
    const ctx = makeCtx(app, {
      path: "articles",
      method: "find",
      params: { provider: "rest", headers: { authorization: `Bearer ${issued.accessToken}` } },
    });

    await expect(authenticate("jwt")(ctx)).rejects.toBeInstanceOf(NotAuthenticated);
  });
});
