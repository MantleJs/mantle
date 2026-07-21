import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeneralError } from "@mantlejs/mantle";

// ─── Mock createOAuthPlugin so we can verify it is called correctly ───────────

const mockPlugin = vi.fn();
vi.mock("@mantlejs/auth-oauth", () => ({
  createOAuthPlugin: vi.fn().mockReturnValue(mockPlugin),
}));

const { linkedinStrategy } = await import("./linkedin-strategy.js");
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

// ─── linkedinStrategy() ───────────────────────────────────────────────────────

describe("linkedinStrategy()", () => {
  it("delegates to createOAuthPlugin with providerKey 'linkedin'", () => {
    const config = { clientId: "cid", clientSecret: "cs" };
    const plugin = linkedinStrategy(config);
    expect(createOAuthPlugin).toHaveBeenCalledWith("linkedin", expect.any(Object), expect.objectContaining(config));
    expect(plugin).toBe(mockPlugin);
  });

  it("defaults entityIdField to 'linkedinId'", () => {
    linkedinStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "linkedin",
      expect.anything(),
      expect.objectContaining({ entityIdField: "linkedinId" }),
    );
  });

  it("preserves custom entityIdField when provided", () => {
    linkedinStrategy({ clientId: "cid", clientSecret: "cs", entityIdField: "liid" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "linkedin",
      expect.anything(),
      expect.objectContaining({ entityIdField: "liid" }),
    );
  });

  it("defaults scope to openid, profile, email", () => {
    linkedinStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "linkedin",
      expect.anything(),
      expect.objectContaining({ scope: ["openid", "profile", "email"] }),
    );
  });

  it("preserves custom scope when provided", () => {
    linkedinStrategy({ clientId: "cid", clientSecret: "cs", scope: ["openid"] });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "linkedin",
      expect.anything(),
      expect.objectContaining({ scope: ["openid"] }),
    );
  });
});

// ─── LinkedIn provider: buildAuthUrl ─────────────────────────────────────────

describe("linkedinProvider.buildAuthUrl()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    linkedinStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("builds a valid LinkedIn authorization URL", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/auth/linkedin/callback",
      scope: ["openid", "profile", "email"],
      state: "abc123",
    });
    expect(url).toContain("https://www.linkedin.com/oauth/v2/authorization");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("state=abc123");
  });

  it("encodes scope as a space-separated string", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["openid", "profile", "email"],
      state: "s",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("openid profile email");
  });

  it("does not emit PKCE parameters", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["openid"],
      state: "s",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("code_challenge")).toBe(false);
    expect(parsed.searchParams.has("code_challenge_method")).toBe(false);
  });

  it("sets usePkce to false", () => {
    expect(provider.usePkce).toBe(false);
  });
});

// ─── LinkedIn provider: exchangeCode ─────────────────────────────────────────

describe("linkedinProvider.exchangeCode()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    linkedinStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("POSTs to LinkedIn's token endpoint and returns access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "litoken123" }));

    const token = await provider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    expect(request.method).toBe("POST");
    expect(token).toBe("litoken123");
  });

  it("throws GeneralError when LinkedIn returns a non-OK response", async () => {
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

// ─── LinkedIn provider: fetchProfile ─────────────────────────────────────────

describe("linkedinProvider.fetchProfile()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    linkedinStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("fetches userinfo with Bearer token and returns normalized profile", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ sub: "li-uid", email: "alice@linkedin.com", name: "Alice" }));

    const profile = await provider.fetchProfile("litoken123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.linkedin.com/v2/userinfo",
      expect.objectContaining({ headers: { Authorization: "Bearer litoken123" } }),
    );
    expect(profile).toEqual({ id: "li-uid", email: "alice@linkedin.com", name: "Alice" });
  });

  it("returns profile without email/name when fields are absent", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ sub: "li-uid" }));
    const profile = await provider.fetchProfile("token");
    expect(profile).toEqual({ id: "li-uid", email: undefined, name: undefined });
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
