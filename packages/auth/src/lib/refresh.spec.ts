import { describe, expect, it, vi } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";
import { NotAuthenticated } from "@mantlejs/mantle";
import { auth } from "./auth.js";
import { memoryRefreshTokenStore } from "./refresh-token-store.js";
import type { AuthConfig, AuthEngine, RefreshTokenStore } from "./types.js";

const SECRET = "refresh-test-secret";

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

function makeEngine(config: Partial<AuthConfig> = {}): AuthEngine {
  const app = makeApp();
  auth({ secret: SECRET, ...config })(app);
  return (app as unknown as { get: (k: string) => AuthEngine }).get("auth");
}

describe("createTokenPair", () => {
  it("issues an access token and a refresh token", async () => {
    const engine = makeEngine();
    const pair = await engine.createTokenPair("user-1");

    expect(engine.verifyJwt(pair.accessToken)).toMatchObject({ sub: "user-1" });
    expect(engine.verifyJwt(pair.refreshToken)).toMatchObject({
      sub: "user-1",
      type: "refresh",
      jti: expect.any(String),
    });
  });

  it("records the refresh jti in the store before returning", async () => {
    const store: RefreshTokenStore = { add: vi.fn(), consume: vi.fn(), revokeAll: vi.fn() };
    const engine = makeEngine({ refreshTokenStore: store });
    const pair = await engine.createTokenPair("user-1");

    const { jti, exp } = engine.verifyJwt(pair.refreshToken);
    expect(store.add).toHaveBeenCalledWith(jti, "user-1", exp);
  });

  it("merges accessExtra claims into the access token only", async () => {
    const engine = makeEngine();
    const pair = await engine.createTokenPair("user-1", { role: "admin" });

    expect(engine.verifyJwt(pair.accessToken)).toMatchObject({ role: "admin" });
    expect(engine.verifyJwt(pair.refreshToken)["role"]).toBeUndefined();
  });
});

describe("refresh strategy", () => {
  it("rotates: a valid refresh token yields a fresh pair and dies", async () => {
    const engine = makeEngine();
    const first = await engine.createTokenPair("user-1");

    const result = await engine.authenticate("refresh", { refreshToken: first.refreshToken }, {});
    expect(typeof result.accessToken).toBe("string");
    expect(typeof result["refreshToken"]).toBe("string");
    expect(result["refreshToken"]).not.toBe(first.refreshToken);

    // The rotated-out token is consumed — replaying it is reuse.
    await expect(engine.authenticate("refresh", { refreshToken: first.refreshToken }, {})).rejects.toBeInstanceOf(
      NotAuthenticated,
    );
  });

  it("revokes the whole family when a consumed token is replayed", async () => {
    const engine = makeEngine();
    const first = await engine.createTokenPair("user-1");
    const rotated = await engine.authenticate("refresh", { refreshToken: first.refreshToken }, {});

    // Replay of the old token → reuse detected.
    await expect(engine.authenticate("refresh", { refreshToken: first.refreshToken }, {})).rejects.toThrow(
      "Refresh token reuse detected",
    );

    // The still-fresh rotated token was revoked along with the family.
    await expect(
      engine.authenticate("refresh", { refreshToken: rotated["refreshToken"] as string }, {}),
    ).rejects.toBeInstanceOf(NotAuthenticated);
  });

  it("does not revoke other subjects on reuse", async () => {
    const engine = makeEngine();
    const alice = await engine.createTokenPair("alice");
    const bob = await engine.createTokenPair("bob");

    await engine.authenticate("refresh", { refreshToken: alice.refreshToken }, {});
    await expect(engine.authenticate("refresh", { refreshToken: alice.refreshToken }, {})).rejects.toBeInstanceOf(
      NotAuthenticated,
    );

    // Bob is unaffected.
    const result = await engine.authenticate("refresh", { refreshToken: bob.refreshToken }, {});
    expect(typeof result.accessToken).toBe("string");
  });

  it("rejects an expired refresh token without touching the store", async () => {
    const store = memoryRefreshTokenStore();
    const consumeSpy = vi.spyOn(store, "consume");
    const engine = makeEngine({ refreshExpiresIn: "-10s", refreshTokenStore: store });
    const pair = await engine.createTokenPair("user-1");

    await expect(engine.authenticate("refresh", { refreshToken: pair.refreshToken }, {})).rejects.toThrow(
      "Invalid refresh token",
    );
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("rejects an access token submitted as a refresh token (type mismatch)", async () => {
    const engine = makeEngine();
    const pair = await engine.createTokenPair("user-1");

    await expect(engine.authenticate("refresh", { refreshToken: pair.accessToken }, {})).rejects.toThrow(
      "Invalid refresh token",
    );
  });

  it("rejects a token signed with a different secret", async () => {
    const other = makeEngine();
    const foreign = other.createJwt({ sub: "user-1", type: "refresh", jti: "x" });

    const app = makeApp();
    auth({ secret: "a-different-secret" })(app);
    const engine = (app as unknown as { get: (k: string) => AuthEngine }).get("auth");

    await expect(engine.authenticate("refresh", { refreshToken: foreign }, {})).rejects.toBeInstanceOf(
      NotAuthenticated,
    );
  });

  it("rejects a missing or empty refreshToken field", async () => {
    const engine = makeEngine();
    await expect(engine.authenticate("refresh", {}, {})).rejects.toBeInstanceOf(NotAuthenticated);
    await expect(engine.authenticate("refresh", { refreshToken: "" }, {})).rejects.toBeInstanceOf(NotAuthenticated);
  });
});

describe("memoryRefreshTokenStore", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;

  it("consumes a token exactly once", () => {
    const store = memoryRefreshTokenStore();
    store.add("jti-1", "user-1", future);
    expect(store.consume("jti-1")).toBe(true);
    expect(store.consume("jti-1")).toBe(false);
  });

  it("returns false for unknown jtis", () => {
    expect(memoryRefreshTokenStore().consume("nope")).toBe(false);
  });

  it("returns false for expired entries", () => {
    const store = memoryRefreshTokenStore();
    store.add("jti-old", "user-1", Math.floor(Date.now() / 1000) - 10);
    expect(store.consume("jti-old")).toBe(false);
  });

  it("revokes all tokens for a subject and only that subject", () => {
    const store = memoryRefreshTokenStore();
    store.add("a1", "alice", future);
    store.add("a2", "alice", future);
    store.add("b1", "bob", future);

    store.revokeAll("alice");

    expect(store.consume("a1")).toBe(false);
    expect(store.consume("a2")).toBe(false);
    expect(store.consume("b1")).toBe(true);
  });

  it("prunes expired entries on add", () => {
    const store = memoryRefreshTokenStore();
    store.add("stale", "user-1", Math.floor(Date.now() / 1000) - 10);
    store.add("fresh", "user-1", future);
    // The stale entry is gone even for revokeAll bookkeeping purposes.
    expect(store.consume("stale")).toBe(false);
    expect(store.consume("fresh")).toBe(true);
  });
});
