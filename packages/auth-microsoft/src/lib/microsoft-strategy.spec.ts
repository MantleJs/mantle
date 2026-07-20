import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeneralError } from "@mantlejs/mantle";

// ─── Mock createOAuthPlugin so we can verify it is called correctly ───────────

const mockPlugin = vi.fn();
vi.mock("@mantlejs/auth-oauth", () => ({
  createOAuthPlugin: vi.fn().mockReturnValue(mockPlugin),
}));

const { microsoftStrategy } = await import("./microsoft-strategy.js");
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

function providerFromLastCall(): Parameters<typeof createOAuthPlugin>[1] {
  const calls = vi.mocked(createOAuthPlugin).mock.calls;
  return calls[calls.length - 1]?.[1] as Parameters<typeof createOAuthPlugin>[1];
}

// ─── microsoftStrategy() ─────────────────────────────────────────────────────

describe("microsoftStrategy()", () => {
  it("delegates to createOAuthPlugin with providerKey 'microsoft'", () => {
    const config = { clientId: "cid", clientSecret: "cs" };
    const plugin = microsoftStrategy(config);
    expect(createOAuthPlugin).toHaveBeenCalledWith("microsoft", expect.any(Object), expect.objectContaining(config));
    expect(plugin).toBe(mockPlugin);
  });

  it("defaults entityIdField to 'microsoftId'", () => {
    microsoftStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "microsoft",
      expect.anything(),
      expect.objectContaining({ entityIdField: "microsoftId" }),
    );
  });

  it("preserves custom entityIdField when provided", () => {
    microsoftStrategy({ clientId: "cid", clientSecret: "cs", entityIdField: "msId" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "microsoft",
      expect.anything(),
      expect.objectContaining({ entityIdField: "msId" }),
    );
  });

  it("defaults scope to openid, profile, email", () => {
    microsoftStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "microsoft",
      expect.anything(),
      expect.objectContaining({ scope: ["openid", "profile", "email"] }),
    );
  });

  it("preserves custom scope when provided", () => {
    microsoftStrategy({ clientId: "cid", clientSecret: "cs", scope: ["email"] });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "microsoft",
      expect.anything(),
      expect.objectContaining({ scope: ["email"] }),
    );
  });

  it("does not forward the tenant option to createOAuthPlugin", () => {
    microsoftStrategy({ clientId: "cid", clientSecret: "cs", tenant: "consumers" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "microsoft",
      expect.anything(),
      expect.not.objectContaining({ tenant: expect.anything() }),
    );
  });
});

// ─── Microsoft provider: buildAuthUrl ────────────────────────────────────────

describe("microsoftProvider.buildAuthUrl()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    microsoftStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = providerFromLastCall();
  });

  it("builds a valid Microsoft authorization URL against the default 'common' tenant", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/auth/microsoft/callback",
      scope: ["openid", "profile"],
      state: "abc123",
      codeVerifier: "verifier-xyz",
    });
    const expectedChallenge = createHash("sha256").update("verifier-xyz").digest("base64url");
    expect(url).toContain("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=abc123");
    expect(url).toContain(`code_challenge=${expectedChallenge}`);
    expect(url).toContain("code_challenge_method=S256");
  });

  it("uses the configured tenant in the authorization URL", () => {
    microsoftStrategy({ clientId: "cid", clientSecret: "cs", tenant: "contoso.onmicrosoft.com" });
    const tenantProvider = providerFromLastCall();
    const url = tenantProvider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["openid"],
      state: "s",
      codeVerifier: "v",
    });
    expect(url).toContain("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
  });

  it("encodes scope as a space-separated string", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["openid", "profile", "email"],
      state: "s",
      codeVerifier: "v",
    });
    expect(url).toContain("scope=openid+profile+email");
  });

  it("sets usePkce to true", () => {
    expect(provider.usePkce).toBe(true);
  });
});

// ─── Microsoft provider: exchangeCode ────────────────────────────────────────

describe("microsoftProvider.exchangeCode()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    microsoftStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = providerFromLastCall();
  });

  it("POSTs to the default-tenant token endpoint and returns access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "mstoken123" }));

    const token = await provider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
      codeVerifier: "verifier",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(request.method).toBe("POST");
    expect(token).toBe("mstoken123");
  });

  it("passes the PKCE code verifier to the token request", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "t" }));

    await provider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
      codeVerifier: "verifier-xyz",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    const body = new URLSearchParams(await request.text());
    expect(body.get("code_verifier")).toBe("verifier-xyz");
  });

  it("POSTs to the configured tenant's token endpoint", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "t" }));
    microsoftStrategy({ clientId: "cid", clientSecret: "cs", tenant: "organizations" });
    const tenantProvider = providerFromLastCall();

    await tenantProvider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
      codeVerifier: "v",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
  });

  it("throws GeneralError when Microsoft returns a non-OK response", async () => {
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

// ─── Microsoft provider: fetchProfile ────────────────────────────────────────

describe("microsoftProvider.fetchProfile()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    microsoftStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = providerFromLastCall();
  });

  it("fetches userinfo with Bearer token and returns normalized profile", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ sub: "ms-uid", email: "alice@outlook.com", name: "Alice" }));

    const profile = await provider.fetchProfile("mstoken123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.microsoft.com/oidc/userinfo",
      expect.objectContaining({ headers: { Authorization: "Bearer mstoken123" } }),
    );
    expect(profile).toEqual({ id: "ms-uid", email: "alice@outlook.com", name: "Alice" });
  });

  it("returns profile without email/name when fields are absent", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ sub: "ms-uid" }));
    const profile = await provider.fetchProfile("token");
    expect(profile).toEqual({ id: "ms-uid", email: undefined, name: undefined });
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
