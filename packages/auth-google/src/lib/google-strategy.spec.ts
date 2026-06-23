import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeneralError } from "@mantlejs/core";

// ─── Mock createOAuthPlugin so we can verify it is called correctly ───────────

const mockPlugin = vi.fn();
vi.mock("@mantlejs/auth-oauth", () => ({
  createOAuthPlugin: vi.fn().mockReturnValue(mockPlugin),
}));

const { googleStrategy } = await import("./google-strategy.js");
const { createOAuthPlugin } = await import("@mantlejs/auth-oauth");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  };
}

function makeErrorResponse(status = 400) {
  return { ok: false, status, json: vi.fn() };
}

// ─── googleStrategy() ────────────────────────────────────────────────────────

describe("googleStrategy()", () => {
  it("delegates to createOAuthPlugin with providerKey 'google'", () => {
    const config = { clientId: "cid", clientSecret: "cs" };
    const plugin = googleStrategy(config);
    expect(createOAuthPlugin).toHaveBeenCalledWith("google", expect.any(Object), expect.objectContaining(config));
    expect(plugin).toBe(mockPlugin);
  });

  it("defaults entityIdField to 'googleId'", () => {
    googleStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "google",
      expect.anything(),
      expect.objectContaining({ entityIdField: "googleId" }),
    );
  });

  it("preserves custom entityIdField when provided", () => {
    googleStrategy({ clientId: "cid", clientSecret: "cs", entityIdField: "gid" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "google",
      expect.anything(),
      expect.objectContaining({ entityIdField: "gid" }),
    );
  });

  it("defaults scope to openid, profile, email", () => {
    googleStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "google",
      expect.anything(),
      expect.objectContaining({ scope: ["openid", "profile", "email"] }),
    );
  });

  it("preserves custom scope when provided", () => {
    googleStrategy({ clientId: "cid", clientSecret: "cs", scope: ["email"] });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "google",
      expect.anything(),
      expect.objectContaining({ scope: ["email"] }),
    );
  });
});

// ─── Google provider: buildAuthUrl ───────────────────────────────────────────

describe("googleProvider.buildAuthUrl()", () => {
  let provider: ReturnType<Parameters<typeof vi.mocked<typeof createOAuthPlugin>>[1]>;

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    googleStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("builds a valid Google authorization URL", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/auth/google/callback",
      scope: ["openid", "profile"],
      state: "abc123",
      codeChallenge: "challenge-xyz",
    });
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=abc123");
    expect(url).toContain("code_challenge=challenge-xyz");
    expect(url).toContain("code_challenge_method=S256");
  });

  it("encodes scope as a space-separated string", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["openid", "profile", "email"],
      state: "s",
    });
    expect(url).toContain("scope=openid+profile+email");
  });

  it("sets usePkce to true", () => {
    expect(provider.usePkce).toBe(true);
  });
});

// ─── Google provider: exchangeCode ───────────────────────────────────────────

describe("googleProvider.exchangeCode()", () => {
  let provider: ReturnType<Parameters<typeof vi.mocked<typeof createOAuthPlugin>>[1]>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    googleStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("POSTs to Google token endpoint and returns access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "gtoken123" }));

    const token = await provider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
      codeVerifier: "verifier",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(token).toBe("gtoken123");
  });

  it("throws GeneralError when Google returns a non-OK response", async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(400));
    await expect(
      provider.exchangeCode({ code: "c", clientId: "i", clientSecret: "s", redirectUri: "r" }),
    ).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ error: "invalid_grant" }));
    await expect(
      provider.exchangeCode({ code: "c", clientId: "i", clientSecret: "s", redirectUri: "r" }),
    ).rejects.toBeInstanceOf(GeneralError);
  });
});

// ─── Google provider: fetchProfile ───────────────────────────────────────────

describe("googleProvider.fetchProfile()", () => {
  let provider: ReturnType<Parameters<typeof vi.mocked<typeof createOAuthPlugin>>[1]>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    googleStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("fetches userinfo with Bearer token and returns normalized profile", async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ sub: "google-uid", email: "alice@gmail.com", name: "Alice" }),
    );

    const profile = await provider.fetchProfile("gtoken123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openidconnect.googleapis.com/v1/userinfo",
      expect.objectContaining({ headers: { Authorization: "Bearer gtoken123" } }),
    );
    expect(profile).toEqual({ id: "google-uid", email: "alice@gmail.com", name: "Alice" });
  });

  it("returns profile without email/name when fields are absent", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ sub: "google-uid" }));
    const profile = await provider.fetchProfile("token");
    expect(profile).toEqual({ id: "google-uid", email: undefined, name: undefined });
  });

  it("throws GeneralError when userinfo endpoint returns non-OK", async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401));
    await expect(provider.fetchProfile("bad-token")).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks sub claim", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ email: "no-sub@example.com" }));
    await expect(provider.fetchProfile("token")).rejects.toBeInstanceOf(GeneralError);
  });
});
