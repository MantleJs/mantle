import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeneralError } from "@mantlejs/mantle";

// ─── Mock createOAuthPlugin so we can verify it is called correctly ───────────

const mockPlugin = vi.fn();
vi.mock("@mantlejs/auth-oauth", () => ({
  createOAuthPlugin: vi.fn().mockReturnValue(mockPlugin),
}));

const { githubStrategy } = await import("./github-strategy.js");
const { createOAuthPlugin } = await import("@mantlejs/auth-oauth");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeErrorResponse(status = 400): Response {
  return new Response(JSON.stringify({ error: "oauth_error" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── githubStrategy() ────────────────────────────────────────────────────────

describe("githubStrategy()", () => {
  it("delegates to createOAuthPlugin with providerKey 'github'", () => {
    const config = { clientId: "cid", clientSecret: "cs" };
    const plugin = githubStrategy(config);
    expect(createOAuthPlugin).toHaveBeenCalledWith("github", expect.any(Object), expect.objectContaining(config));
    expect(plugin).toBe(mockPlugin);
  });

  it("defaults entityIdField to 'githubId'", () => {
    githubStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "github",
      expect.anything(),
      expect.objectContaining({ entityIdField: "githubId" }),
    );
  });

  it("preserves custom entityIdField when provided", () => {
    githubStrategy({ clientId: "cid", clientSecret: "cs", entityIdField: "ghid" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "github",
      expect.anything(),
      expect.objectContaining({ entityIdField: "ghid" }),
    );
  });

  it("defaults scope to read:user and user:email", () => {
    githubStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "github",
      expect.anything(),
      expect.objectContaining({ scope: ["read:user", "user:email"] }),
    );
  });

  it("preserves custom scope when provided", () => {
    githubStrategy({ clientId: "cid", clientSecret: "cs", scope: ["repo"] });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "github",
      expect.anything(),
      expect.objectContaining({ scope: ["repo"] }),
    );
  });
});

// ─── GitHub provider: buildAuthUrl ───────────────────────────────────────────

describe("githubProvider.buildAuthUrl()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    githubStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("builds a valid GitHub authorization URL", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/auth/github/callback",
      scope: ["read:user", "user:email"],
      state: "abc123",
    });
    expect(url).toContain("https://github.com/login/oauth/authorize");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("state=abc123");
  });

  it("encodes scope as a space-separated string", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["read:user", "user:email"],
      state: "s",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("read:user user:email");
  });

  it("sets usePkce to false", () => {
    expect(provider.usePkce).toBe(false);
  });
});

// ─── GitHub provider: exchangeCode ───────────────────────────────────────────

describe("githubProvider.exchangeCode()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    githubStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("POSTs to GitHub token endpoint and returns access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "ghtoken123" }));

    const token = await provider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://github.com/login/oauth/access_token");
    expect(request.method).toBe("POST");
    expect(token).toBe("ghtoken123");
  });

  it("throws GeneralError when GitHub returns a non-OK response", async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(400));
    await expect(
      provider.exchangeCode({ code: "c", clientId: "i", clientSecret: "s", redirectUri: "r" }),
    ).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ error: "bad_verification_code" }));
    await expect(
      provider.exchangeCode({ code: "c", clientId: "i", clientSecret: "s", redirectUri: "r" }),
    ).rejects.toBeInstanceOf(GeneralError);
  });
});

// ─── GitHub provider: fetchProfile ───────────────────────────────────────────

describe("githubProvider.fetchProfile()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    githubStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("fetches user with Bearer token and returns normalized profile", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 12345, email: "alice@github.com", name: "Alice" }));

    const profile = await provider.fetchProfile("ghtoken123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ghtoken123" }),
      }),
    );
    expect(profile).toEqual({ id: "12345", email: "alice@github.com", name: "Alice" });
  });

  it("coerces numeric id to string", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 99999 }));
    const profile = await provider.fetchProfile("token");
    expect(profile.id).toBe("99999");
  });

  it("returns profile without email/name when fields are absent", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 12345 }));
    const profile = await provider.fetchProfile("token");
    expect(profile).toEqual({ id: "12345", email: undefined, name: undefined });
  });

  it("throws GeneralError when user endpoint returns non-OK", async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401));
    await expect(provider.fetchProfile("bad-token")).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks id", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ email: "no-id@example.com" }));
    await expect(provider.fetchProfile("token")).rejects.toBeInstanceOf(GeneralError);
  });
});
