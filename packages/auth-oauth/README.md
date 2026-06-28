# @mantlejs/auth-oauth

Shared OAuth 2.0 base for [Mantle JS](https://github.com/mantlejs/mantle). Provides the state management, PKCE, find-or-create user logic, and Express route registration that all OAuth strategy packages (`auth-google`, `auth-github`, etc.) build on. Not used directly by application code.

---

## Installation

```bash
npm install @mantlejs/auth-oauth
```

---

## Concepts

### Provider contract

Each strategy package implements the `OAuthProvider` interface — three methods covering the provider-specific parts of the authorization code flow:

```typescript
interface OAuthProvider {
  usePkce: boolean;
  defaultScope: string[];
  buildAuthUrl(params: AuthUrlParams): string;
  exchangeCode(params: CodeExchangeParams): Promise<string>;  // returns provider access token
  fetchProfile(accessToken: string): Promise<OAuthProfile>;   // returns { id, email?, name? }
}
```

### `createOAuthPlugin`

The factory that wires a provider into Mantle. It registers two Express routes (`GET /auth/{providerKey}` and `GET /auth/{providerKey}/callback`), manages PKCE state, performs find-or-create on the configured user service, and issues the Mantle JWT pair via `@mantlejs/auth`.

### State store

An in-memory `Map` keyed on the OAuth `state` parameter. Entries expire after 10 minutes and are cleaned up lazily on each redirect request. The `codeVerifier` (PKCE only) is stored alongside the state and passed to the token exchange.

### Find-or-create

On callback, the plugin calls `app.service(entity).find({ query: { [entityIdField]: profile.id } })`. If the result is empty, it calls `app.service(entity).create(...)` with the normalized profile fields. The resulting user record is used to mint the Mantle JWT pair.

---

## Quick start (writing a new strategy)

```typescript
import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type { OAuthPluginConfig, OAuthProvider } from "@mantlejs/auth-oauth";

export type MyStrategyConfig = OAuthPluginConfig;

const myProvider: OAuthProvider = {
  usePkce: false,
  defaultScope: ["user"],

  buildAuthUrl({ clientId, redirectUri, scope, state }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scope.join(" "),
      state,
    });
    return `https://provider.example.com/oauth/authorize?${params}`;
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
    const res = await fetch("https://provider.example.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
    });
    if (!res.ok) throw new GeneralError("Token exchange failed");
    const data = await res.json() as Record<string, unknown>;
    return data["access_token"] as string;
  },

  async fetchProfile(accessToken) {
    const res = await fetch("https://api.provider.example.com/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new GeneralError("Profile fetch failed");
    const data = await res.json() as Record<string, unknown>;
    return { id: String(data["id"]), email: data["email"] as string };
  },
};

export function myStrategy(config: MyStrategyConfig): MantlePlugin {
  return createOAuthPlugin("myprovider", myProvider, {
    ...config,
    entityIdField: config.entityIdField ?? "myProviderId",
  });
}
```

Register alongside the other plugins:

```typescript
app
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(myStrategy({ clientId: "...", clientSecret: "..." }));
```

This registers `GET /auth/myprovider` and `GET /auth/myprovider/callback` on the Express app.

---

## API

### `createOAuthPlugin(providerKey, provider, config)`

```typescript
function createOAuthPlugin(
  providerKey: string,
  provider: OAuthProvider,
  config: OAuthPluginConfig,
): MantlePlugin;
```

| Parameter | Description |
| --- | --- |
| `providerKey` | Short identifier for the provider (`'google'`, `'github'`, `'facebook'`). Used in default route paths and the default `entityIdField`. |
| `provider` | The `OAuthProvider` implementation for this strategy. |
| `config` | User-supplied configuration (client ID, secret, optional overrides). |

**Throws** at plugin registration time if `@mantlejs/auth` or `@mantlejs/express` is not configured before this plugin.

**Routes registered:**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/{providerKey}` | Redirect to provider consent screen. Generates state + PKCE (if `provider.usePkce`). |
| `GET` | `config.callbackUrl` | Verify state, exchange code, fetch profile, find-or-create user, issue JWT pair. |

**Response on successful callback:**

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": { "id": "...", "email": "...", "name": "..." }
}
```

#### `OAuthPluginConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `clientId` | `string` | — | OAuth application client ID (required) |
| `clientSecret` | `string` | — | OAuth application client secret (required) |
| `callbackUrl` | `string` | `/auth/{providerKey}/callback` | Path for the callback route |
| `scope` | `string[]` | `provider.defaultScope` | OAuth scopes to request |
| `entity` | `string` | `'users'` | Service used to find or create users |
| `entityIdField` | `string` | `'{providerKey}Id'` | Field matched against the provider's user ID |

---

## Types

```typescript
import type {
  OAuthProvider,
  OAuthProfile,
  OAuthPluginConfig,
  AuthUrlParams,
  CodeExchangeParams,
} from "@mantlejs/auth-oauth";
```

| Type | Description |
| --- | --- |
| `OAuthProvider` | Interface that each strategy package implements |
| `OAuthProfile` | Normalized profile: `{ id: string; email?: string; name?: string }` |
| `OAuthPluginConfig` | Shared config options for all OAuth strategies |
| `AuthUrlParams` | Params passed to `provider.buildAuthUrl()` |
| `CodeExchangeParams` | Params passed to `provider.exchangeCode()` |

---

## Development

```bash
npx nx build auth-oauth   # compile
npx nx test auth-oauth    # run tests
npx nx lint auth-oauth    # lint
```

---

## Publishing

```bash
npx nx build auth-oauth
cd packages/auth-oauth
npm publish --access public
```
