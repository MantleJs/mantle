import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeneralError } from "@mantlejs/mantle";

// ─── Mock createOAuthPlugin so we can verify it is called correctly ───────────

const mockPlugin = vi.fn();
vi.mock("@mantlejs/auth-oauth", () => ({
  createOAuthPlugin: vi.fn().mockReturnValue(mockPlugin),
}));

const { facebookStrategy } = await import("./facebook-strategy.js");
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

// ─── facebookStrategy() ──────────────────────────────────────────────────────

describe("facebookStrategy()", () => {
  it("delegates to createOAuthPlugin with providerKey 'facebook'", () => {
    const config = { clientId: "cid", clientSecret: "cs" };
    const plugin = facebookStrategy(config);
    expect(createOAuthPlugin).toHaveBeenCalledWith("facebook", expect.any(Object), expect.objectContaining(config));
    expect(plugin).toBe(mockPlugin);
  });

  it("defaults entityIdField to 'facebookId'", () => {
    facebookStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "facebook",
      expect.anything(),
      expect.objectContaining({ entityIdField: "facebookId" }),
    );
  });

  it("preserves custom entityIdField when provided", () => {
    facebookStrategy({ clientId: "cid", clientSecret: "cs", entityIdField: "fbId" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "facebook",
      expect.anything(),
      expect.objectContaining({ entityIdField: "fbId" }),
    );
  });

  it("defaults scope to email, public_profile", () => {
    facebookStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "facebook",
      expect.anything(),
      expect.objectContaining({ scope: ["email", "public_profile"] }),
    );
  });

  it("preserves custom scope when provided", () => {
    facebookStrategy({ clientId: "cid", clientSecret: "cs", scope: ["email"] });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "facebook",
      expect.anything(),
      expect.objectContaining({ scope: ["email"] }),
    );
  });
});

// ─── Facebook provider: buildAuthUrl ─────────────────────────────────────────

describe("facebookProvider.buildAuthUrl()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    facebookStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("builds a valid Facebook authorization URL", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/auth/facebook/callback",
      scope: ["email", "public_profile"],
      state: "abc123",
    });
    expect(url).toContain("https://www.facebook.com/v16.0/dialog/oauth");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=abc123");
  });

  it("encodes scope as a space-separated string", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["email", "public_profile"],
      state: "s",
    });
    expect(url).toContain("scope=email+public_profile");
  });

  it("sets usePkce to false", () => {
    expect(provider.usePkce).toBe(false);
  });
});

// ─── Facebook provider: exchangeCode ─────────────────────────────────────────

describe("facebookProvider.exchangeCode()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    facebookStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("POSTs to the Facebook token endpoint and returns access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "fbtoken123" }));

    const token = await provider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://graph.facebook.com/v16.0/oauth/access_token");
    expect(request.method).toBe("POST");
    expect(token).toBe("fbtoken123");
  });

  it("throws GeneralError when Facebook returns a non-OK response", async () => {
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

// ─── Facebook provider: fetchProfile ─────────────────────────────────────────

describe("facebookProvider.fetchProfile()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    facebookStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("fetches profile with access_token query param and returns normalized profile", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: "fb-uid", email: "alice@example.com", name: "Alice" }));

    const profile = await provider.fetchProfile("fbtoken123");

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("https://graph.facebook.com/me"));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("access_token=fbtoken123"));
    expect(profile).toEqual({ id: "fb-uid", email: "alice@example.com", name: "Alice" });
  });

  it("returns profile without email/name when fields are absent", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: "fb-uid" }));
    const profile = await provider.fetchProfile("token");
    expect(profile).toEqual({ id: "fb-uid", email: undefined, name: undefined });
  });

  it("throws GeneralError when profile endpoint returns non-OK", async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401));
    await expect(provider.fetchProfile("bad-token")).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks id field", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ email: "no-id@example.com" }));
    await expect(provider.fetchProfile("token")).rejects.toBeInstanceOf(GeneralError);
  });
});
