import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeneralError } from "@mantlejs/mantle";

// ─── Mock createOAuthPlugin so we can verify it is called correctly ───────────

const mockPlugin = vi.fn();
vi.mock("@mantlejs/auth-oauth", () => ({
  createOAuthPlugin: vi.fn().mockReturnValue(mockPlugin),
}));

const { appleStrategy } = await import("./apple-strategy.js");
const { createOAuthPlugin } = await import("@mantlejs/auth-oauth");

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Arctic imports the key via WebCrypto for ES256 signing, so the spec needs a real P-256 key.
const TEST_PRIVATE_KEY = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const BASE_CONFIG = {
  clientId: "com.example.app.web",
  teamId: "TEAM123456",
  keyId: "KEY1234567",
  privateKey: TEST_PRIVATE_KEY,
};

function makeIdToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256" })}.${encode(payload)}.signature`;
}

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeErrorResponse(status = 400): Response {
  return new Response(JSON.stringify({ error: "oauth_error" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Provider = Parameters<typeof createOAuthPlugin>[1];

function capturedProvider(): Provider {
  return vi.mocked(createOAuthPlugin).mock.calls[0]?.[1] as Provider;
}

// ─── appleStrategy() ─────────────────────────────────────────────────────────

describe("appleStrategy()", () => {
  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
  });

  it("delegates to createOAuthPlugin with providerKey 'apple'", () => {
    const plugin = appleStrategy(BASE_CONFIG);
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "apple",
      expect.any(Object),
      expect.objectContaining({ clientId: "com.example.app.web" }),
    );
    expect(plugin).toBe(mockPlugin);
  });

  it("passes an empty clientSecret and keeps the key material out of the plugin config", () => {
    appleStrategy(BASE_CONFIG);
    const config = vi.mocked(createOAuthPlugin).mock.calls[0]?.[2] as unknown as Record<string, unknown>;
    expect(config["clientSecret"]).toBe("");
    expect(config).not.toHaveProperty("teamId");
    expect(config).not.toHaveProperty("keyId");
    expect(config).not.toHaveProperty("privateKey");
  });

  it("defaults entityIdField to 'appleId'", () => {
    appleStrategy(BASE_CONFIG);
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "apple",
      expect.anything(),
      expect.objectContaining({ entityIdField: "appleId" }),
    );
  });

  it("preserves custom entityIdField when provided", () => {
    appleStrategy({ ...BASE_CONFIG, entityIdField: "aid" });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "apple",
      expect.anything(),
      expect.objectContaining({ entityIdField: "aid" }),
    );
  });

  it("defaults scope to name, email", () => {
    appleStrategy(BASE_CONFIG);
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "apple",
      expect.anything(),
      expect.objectContaining({ scope: ["name", "email"] }),
    );
  });

  it("preserves custom scope when provided", () => {
    appleStrategy({ ...BASE_CONFIG, scope: ["email"] });
    expect(createOAuthPlugin).toHaveBeenCalledWith(
      "apple",
      expect.anything(),
      expect.objectContaining({ scope: ["email"] }),
    );
  });
});

// ─── Apple provider: buildAuthUrl ────────────────────────────────────────────

describe("appleProvider.buildAuthUrl()", () => {
  let provider: Provider;

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    appleStrategy(BASE_CONFIG);
    provider = capturedProvider();
  });

  it("builds a valid Apple authorization URL with response_mode=form_post", () => {
    const url = provider.buildAuthUrl({
      clientId: "com.example.app.web",
      redirectUri: "https://app.example.com/auth/apple/callback",
      scope: ["name", "email"],
      state: "abc123",
    });
    expect(url).toContain("https://appleid.apple.com/auth/authorize");
    expect(url).toContain("client_id=com.example.app.web");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=abc123");
    expect(url).toContain("scope=name+email");
    expect(url).toContain("response_mode=form_post");
  });

  it("does not emit PKCE parameters", () => {
    const url = provider.buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      scope: ["name", "email"],
      state: "s",
    });
    expect(url).not.toContain("code_challenge");
    expect(provider.usePkce).toBe(false);
  });

  it("declares a POST callback", () => {
    expect(provider.callbackMethod).toBe("POST");
  });
});

// ─── Apple provider: exchangeCode ────────────────────────────────────────────

describe("appleProvider.exchangeCode()", () => {
  let provider: Provider;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createOAuthPlugin).mockClear();
    appleStrategy(BASE_CONFIG);
    provider = capturedProvider();
  });

  it("POSTs to Apple's token endpoint with a signed ES256 client secret and returns the id_token", async () => {
    const idToken = makeIdToken({ sub: "apple-uid" });
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "atoken", id_token: idToken }));

    const token = await provider.exchangeCode({
      code: "auth-code",
      clientId: "com.example.app.web",
      clientSecret: "",
      redirectUri: "https://app.example.com/cb",
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://appleid.apple.com/auth/token");
    expect(request.method).toBe("POST");

    const body = new URLSearchParams(await request.text());
    expect(body.get("client_id")).toBe("com.example.app.web");
    const clientSecret = body.get("client_secret") ?? "";
    expect(clientSecret.split(".")).toHaveLength(3);
    const header = JSON.parse(Buffer.from(clientSecret.split(".")[0] ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >;
    expect(header["alg"]).toBe("ES256");
    expect(header["kid"]).toBe("KEY1234567");

    expect(token).toBe(idToken);
  });

  it("throws GeneralError when Apple returns a non-OK response", async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(400));
    await expect(
      provider.exchangeCode({ code: "c", clientId: "i", clientSecret: "", redirectUri: "r" }),
    ).rejects.toBeInstanceOf(GeneralError);
  });

  it("throws GeneralError when response lacks id_token", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ access_token: "atoken" }));
    await expect(
      provider.exchangeCode({ code: "c", clientId: "i", clientSecret: "", redirectUri: "r" }),
    ).rejects.toBeInstanceOf(GeneralError);
  });
});

// ─── Apple provider: fetchProfile ────────────────────────────────────────────

describe("appleProvider.fetchProfile()", () => {
  let provider: Provider;

  beforeEach(() => {
    vi.mocked(createOAuthPlugin).mockClear();
    appleStrategy(BASE_CONFIG);
    provider = capturedProvider();
  });

  it("decodes the id_token payload into a normalized profile", async () => {
    const profile = await provider.fetchProfile(makeIdToken({ sub: "apple-uid", email: "alice@example.com" }));
    expect(profile).toEqual({ id: "apple-uid", email: "alice@example.com", name: undefined });
  });

  it("returns profile without email when the claim is absent", async () => {
    const profile = await provider.fetchProfile(makeIdToken({ sub: "apple-uid" }));
    expect(profile).toEqual({ id: "apple-uid", email: undefined, name: undefined });
  });

  it("reads the first-login user body field into name", async () => {
    const profile = await provider.fetchProfile(makeIdToken({ sub: "apple-uid" }), {
      body: { user: JSON.stringify({ name: { firstName: "Jane", lastName: "Doe" } }) },
    });
    expect(profile.name).toBe("Jane Doe");
  });

  it("uses a lone firstName when lastName is absent", async () => {
    const profile = await provider.fetchProfile(makeIdToken({ sub: "apple-uid" }), {
      body: { user: JSON.stringify({ name: { firstName: "Jane" } }) },
    });
    expect(profile.name).toBe("Jane");
  });

  it("ignores a malformed user body field", async () => {
    const profile = await provider.fetchProfile(makeIdToken({ sub: "apple-uid", email: "a@b.c" }), {
      body: { user: "{not json" },
    });
    expect(profile).toEqual({ id: "apple-uid", email: "a@b.c", name: undefined });
  });

  it("throws GeneralError when the id_token lacks a sub claim", async () => {
    await expect(provider.fetchProfile(makeIdToken({ email: "no-sub@example.com" }))).rejects.toBeInstanceOf(
      GeneralError,
    );
  });

  it("throws GeneralError on a malformed id_token", async () => {
    await expect(provider.fetchProfile("not-a-jwt")).rejects.toBeInstanceOf(GeneralError);
  });
});
