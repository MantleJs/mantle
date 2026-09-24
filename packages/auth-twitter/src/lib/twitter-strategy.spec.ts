import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeneralError } from "@mantlejs/mantle";

// ─── Mock createOAuthPlugin so we can verify it is called correctly ───────────

const mockPlugin = vi.fn();
vi.mock("@mantlejs/auth-oauth", () => ({
  createOAuthPlugin: vi.fn().mockReturnValue(mockPlugin),
}));

const { twitterStrategy } = await import("./twitter-strategy.js");
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

// ─── twitterStrategy() ────────────────────────────────────────────────────────

describe("twitterStrategy()", () => {
  it("delegates to createOAuthPlugin with providerKey 'twitter'", () => {
    const config = { clientId: "cid", clientSecret: "cs" };
    const plugin = twitterStrategy(config);
    expect(createOAuthPlugin).toHaveBeenCalledWith("twitter", expect.any(Object), expect.objectContaining(config));
    expect(plugin).toBe(mockPlugin);
  });

  it("defaults entityIdField to 'twitterId'", () => {
    twitterStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "twitter",
      expect.anything(),
      expect.objectContaining({ entityIdField: "twitterId" }),
    );
  });

  it("preserves custom entityIdField when provided", () => {
    twitterStrategy({ clientId: "cid", clientSecret: "cs", entityIdField: "xId" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "twitter",
      expect.anything(),
      expect.objectContaining({ entityIdField: "xId" }),
    );
  });

  it("defaults scope to users.read and tweet.read", () => {
    twitterStrategy({ clientId: "cid", clientSecret: "cs" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "twitter",
      expect.anything(),
      expect.objectContaining({ scope: ["users.read", "tweet.read"] }),
    );
  });

  it("preserves custom scope when provided", () => {
    twitterStrategy({ clientId: "cid", clientSecret: "cs", scope: ["users.read"] });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "twitter",
      expect.anything(),
      expect.objectContaining({ scope: ["users.read"] }),
    );
  });
});

// ─── Twitter provider: buildAuthUrl ────────────────────────────────────────────

describe("twitterProvider.buildAuthUrl()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    twitterStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("builds a valid X authorization URL with a PKCE code challenge", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/auth/twitter/callback",
      scope: ["users.read", "tweet.read"],
      state: "abc123",
      codeVerifier: "verifier-xyz",
    });
    const expectedChallenge = createHash("sha256").update("verifier-xyz").digest("base64url");
    expect(url).toContain("https://twitter.com/i/oauth2/authorize");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=abc123");
    expect(url).toContain(`code_challenge=${expectedChallenge}`);
    expect(url).toContain("code_challenge_method=S256");
  });

  it("encodes scope as a space-separated string", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["users.read", "tweet.read"],
      state: "s",
    });
    expect(url).toContain("scope=users.read+tweet.read");
  });

  it("sets usePkce to true", () => {
    expect(provider.usePkce).toBe(true);
  });
});

// ─── Twitter provider: exchangeCode ────────────────────────────────────────────

describe("twitterProvider.exchangeCode()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    twitterStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("POSTs to X's token endpoint and returns access_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "xtoken123" }));

    const token = await provider.exchangeCode({
      code: "auth-code",
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://app.example.com/cb",
      codeVerifier: "verifier",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://api.twitter.com/2/oauth2/token");
    expect(request.method).toBe("POST");
    expect(token).toBe("xtoken123");
  });

  it("throws GeneralError when X returns a non-OK response", async () => {
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

// ─── Twitter provider: fetchProfile ────────────────────────────────────────────

describe("twitterProvider.fetchProfile()", () => {
  let provider: Parameters<typeof createOAuthPlugin>[1];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    twitterStrategy({ clientId: "cid", clientSecret: "cs" });
    provider = vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as typeof provider;
  });

  it("fetches users/me with Bearer token and returns normalized profile", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: "twitter-uid", name: "Alice", username: "alice" } }));

    const profile = await provider.fetchProfile("xtoken123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.com/2/users/me",
      expect.objectContaining({ headers: { Authorization: "Bearer xtoken123" } }),
    );
    expect(profile).toEqual({ id: "twitter-uid", email: undefined, name: "Alice" });
  });

  it("returns profile without name when the field is absent", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: "twitter-uid", username: "alice" } }));
    const profile = await provider.fetchProfile("token");
    expect(profile).toEqual({ id: "twitter-uid", email: undefined, name: undefined });
  });

  it("always normalizes email to undefined — X's default users/me response never includes it", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: "twitter-uid", name: "Alice" } }));
    const profile = await provider.fetchProfile("token");
    expect(profile.email).toBeUndefined();
  });

  it("throws GeneralError when the userinfo endpoint returns non-OK", async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401));
    await expect(provider.fetchProfile("bad-token")).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks an id field", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { name: "no-id" } }));
    await expect(provider.fetchProfile("token")).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks a data object entirely", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({}));
    await expect(provider.fetchProfile("token")).rejects.toBeInstanceOf(GeneralError);
  });
});
