# @mantlejs/auth-oauth

Shared OAuth 2.0 base for [Mantle JS](https://github.com/mantlejs/mantle). Provides the state management, PKCE, find-or-create user logic, and route registration that all OAuth strategy packages (`auth-google`, `auth-github`, etc.) build on. Not used directly by application code.

Protocol plumbing — authorization URL construction, token exchange, PKCE derivation — is delegated to
[Arctic](https://arcticjs.dev) as an implementation dependency (see
[ADR-002](../../docs/decisions/adr-002-arctic-oauth-internals.md)); strategy packages hand-write only
profile normalization.

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
  exchangeCode(params: CodeExchangeParams): Promise<string>; // returns provider access token
  fetchProfile(accessToken: string): Promise<OAuthProfile>; // returns { id, email?, name? }
}
```

### `createOAuthPlugin`

The factory that wires a provider into Mantle. It registers two routes (`GET /auth/{providerKey}` and `GET /auth/{providerKey}/callback`) on the transport's `http:router`, manages PKCE state (generating the code verifier via Arctic; the provider derives the challenge), performs find-or-create on the configured user service, and issues the Mantle JWT pair via `@mantlejs/auth`.

### State store

Pending OAuth state is kept in an `OAuthStateStore` keyed on the OAuth `state` parameter. Entries expire after 10 minutes and are cleaned up lazily on each redirect request. The `codeVerifier` (PKCE only) is stored alongside the state and passed to the token exchange.

The default store is an in-process, in-memory `Map` — fine for a single instance, **wrong for multi-instance deployments** (Cloud Run, horizontal scaling behind a load balancer), where the callback request can land on a different instance than the one that issued the state. Inject the Redis-backed store from [`@mantlejs/auth-redis`](../auth-redis/README.md) instead (store methods are sync-or-async, so any shared backend fits):

```typescript
import { Redis } from "ioredis";
import { redisStateStore } from "@mantlejs/auth-redis";

const redis = new Redis(process.env.REDIS_URL!);

app.configure(googleStrategy({ clientId, clientSecret, stateStore: redisStateStore(redis) }));
```

### Find-or-create

On callback, the plugin calls `app.service(entity).find({ query: { [entityIdField]: profile.id } })`. If the result is empty, it calls `app.service(entity).create(...)` with the normalized profile fields. The resulting user record is used to mint the Mantle JWT pair.

---

## Quick start (writing a new strategy)

Arctic ships clients for ~60 providers — pick the matching class (or fall back to its generic
`OAuth2Client` with explicit endpoints) and hand-write only the profile normalization:

```typescript
import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { Discord } from "arctic"; // or OAuth2Client for providers Arctic doesn't ship
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type { OAuthPluginConfig, OAuthProvider } from "@mantlejs/auth-oauth";

export type MyStrategyConfig = OAuthPluginConfig;

const myProvider: OAuthProvider = {
  usePkce: false, // when true, buildAuthUrl receives a codeVerifier; Arctic derives the S256 challenge
  defaultScope: ["identify", "email"],

  buildAuthUrl({ clientId, redirectUri, scope, state }) {
    const client = new Discord(clientId, "", redirectUri); // secret unused for URL construction
    return client.createAuthorizationURL(state, scope).toString();
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
    const client = new Discord(clientId, clientSecret, redirectUri);
    try {
      const tokens = await client.validateAuthorizationCode(code);
      return tokens.accessToken();
    } catch {
      throw new GeneralError("Token exchange failed");
    }
  },

  async fetchProfile(accessToken) {
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new GeneralError("Profile fetch failed");
    const data = (await res.json()) as Record<string, unknown>;
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
function createOAuthPlugin(providerKey: string, provider: OAuthProvider, config: OAuthPluginConfig): MantlePlugin;
```

| Parameter     | Description                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `providerKey` | Short identifier for the provider (`'google'`, `'github'`, `'facebook'`). Used in default route paths and the default `entityIdField`. |
| `provider`    | The `OAuthProvider` implementation for this strategy.                                                                                  |
| `config`      | User-supplied configuration (client ID, secret, optional overrides).                                                                   |

**Throws** at plugin registration time if `@mantlejs/auth` or `@mantlejs/express` is not configured before this plugin.

**Routes registered:**

| Method | Path                  | Description                                                                          |
| ------ | --------------------- | ------------------------------------------------------------------------------------ |
| `GET`  | `/auth/{providerKey}` | Redirect to provider consent screen. Generates state + PKCE (if `provider.usePkce`). |
| `GET`  | `config.callbackUrl`  | Verify state, exchange code, fetch profile, find-or-create user, issue JWT pair.     |

**Response on successful callback:**

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": { "id": "...", "email": "...", "name": "..." }
}
```

#### `OAuthPluginConfig`

| Field           | Type              | Default                        | Description                                                                                                       |
| --------------- | ----------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `clientId`      | `string`          | —                              | OAuth application client ID (required)                                                                            |
| `clientSecret`  | `string`          | —                              | OAuth application client secret (required)                                                                        |
| `callbackUrl`   | `string`          | `/auth/{providerKey}/callback` | Path for the callback route                                                                                       |
| `scope`         | `string[]`        | `provider.defaultScope`        | OAuth scopes to request                                                                                           |
| `entity`        | `string`          | `'users'`                      | Service used to find or create users                                                                              |
| `entityIdField` | `string`          | `'{providerKey}Id'`            | Field matched against the provider's user ID                                                                      |
| `stateStore`    | `OAuthStateStore` | in-memory                      | Store for pending OAuth state. Multi-instance deployments must inject a shared (e.g. Redis-backed) implementation |

---

## Types

```typescript
import type {
  OAuthProvider,
  OAuthProfile,
  OAuthPluginConfig,
  OAuthStateStore,
  OAuthStateData,
  AuthUrlParams,
  CodeExchangeParams,
} from "@mantlejs/auth-oauth";
```

| Type                 | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `OAuthProvider`      | Interface that each strategy package implements                     |
| `OAuthProfile`       | Normalized profile: `{ id: string; email?: string; name?: string }` |
| `OAuthPluginConfig`  | Shared config options for all OAuth strategies                      |
| `OAuthStateStore`    | Store for pending OAuth state — inject via `config.stateStore`      |
| `OAuthStateData`     | Stored entry: `{ codeVerifier?: string; expiresAt: number }`        |
| `AuthUrlParams`      | Params passed to `provider.buildAuthUrl()`                          |
| `CodeExchangeParams` | Params passed to `provider.exchangeCode()`                          |

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
