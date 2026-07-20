# @mantlejs/auth-microsoft

Microsoft (Entra ID) OAuth 2.0 strategy for [Mantle JS](https://github.com/mantlejs/mantle). Implements the authorization code flow with PKCE — no Passport.js dependency. Registers `GET /auth/microsoft` and `GET /auth/microsoft/callback` on the HTTP transport, then finds or creates a user record and returns a Mantle JWT pair.

---

## Installation

```bash
npm install @mantlejs/auth-microsoft
```

---

## Concepts

### PKCE

Microsoft Sign-In uses the authorization code flow with PKCE (Proof Key for Code Exchange). On each redirect request the plugin generates a fresh `code_verifier` (via [Arctic](https://arcticjs.dev), which also derives the SHA-256 / base64url `code_challenge` — see [ADR-002](../../docs/decisions/adr-002-arctic-oauth-internals.md)). The verifier is stored server-side against a random `state` token and passed to the token exchange on callback.

### Tenant

Entra ID scopes sign-in to a tenant. The default, `"common"`, accepts both work/school (Entra ID) and personal Microsoft accounts. Set `tenant` to `"organizations"` (work/school only), `"consumers"` (personal only), or a specific tenant ID to restrict who can sign in — it must match the **Supported account types** of your app registration.

### Find-or-create

On callback the plugin searches the configured user service for a record where `microsoftId` (configurable) matches the `sub` claim from Microsoft Graph's OIDC userinfo endpoint. If no record is found, it creates one with `{ microsoftId, email, name }` from the profile. The same user is returned on every subsequent sign-in.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { microsoftStrategy } from "@mantlejs/auth-microsoft";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(
    microsoftStrategy({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    }),
  );

app.listen(3030);
```

**Sign-in flow:**

1. Redirect the browser to `GET /auth/microsoft`
2. User authenticates on Microsoft and consents
3. Microsoft redirects to `GET /auth/microsoft/callback?code=...&state=...`
4. The plugin exchanges the code, fetches the profile, finds or creates the user, and responds:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "microsoftId": "AAAA...", "email": "alice@outlook.com", "name": "Alice" }
}
```

---

## API

### `microsoftStrategy(config)`

```typescript
function microsoftStrategy(config: MicrosoftStrategyConfig): MantlePlugin;

interface MicrosoftStrategyConfig extends OAuthPluginConfig {
  tenant?: string; // Default: 'common'
}
```

| Field           | Type       | Default                          | Description                                                                    |
| --------------- | ---------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `clientId`      | `string`   | —                                | Entra ID application (client) ID (required)                                    |
| `clientSecret`  | `string`   | —                                | Entra ID client secret (required)                                              |
| `tenant`        | `string`   | `'common'`                       | Entra tenant: `'common'`, `'organizations'`, `'consumers'`, or a tenant ID     |
| `callbackUrl`   | `string`   | `'/auth/microsoft/callback'`     | Callback path — must match the redirect URI registered in the app registration |
| `scope`         | `string[]` | `['openid', 'profile', 'email']` | Microsoft OAuth scopes                                                         |
| `entity`        | `string`   | `'users'`                        | Mantle service used to find or create users                                    |
| `entityIdField` | `string`   | `'microsoftId'`                  | Field on the user record matched against Microsoft's `sub` claim               |

**Routes registered:**

| Method | Path                       | Description                            |
| ------ | -------------------------- | -------------------------------------- |
| `GET`  | `/auth/microsoft`          | Redirect to Microsoft sign-in          |
| `GET`  | `/auth/microsoft/callback` | Handle callback, issue Mantle JWT pair |

**Must be configured after** the transport (e.g. `express()`) and `auth()`.

---

## Types

```typescript
import type { MicrosoftStrategyConfig } from "@mantlejs/auth-microsoft";
```

`MicrosoftStrategyConfig` extends `OAuthPluginConfig` from `@mantlejs/auth-oauth` with the optional `tenant` field.

---

## Microsoft Entra admin center setup

1. Register an application at [entra.microsoft.com](https://entra.microsoft.com) → **App registrations** → **New registration**
2. Choose the **Supported account types** matching your `tenant` setting
3. Add a **Web** redirect URI: `https://your-domain.com/auth/microsoft/callback`
4. Under **Certificates & secrets**, create a client secret
5. Copy the **Application (client) ID** and the secret value into your environment

---

## Development

```bash
npx nx build auth-microsoft   # compile
npx nx test auth-microsoft    # run tests
npx nx lint auth-microsoft    # lint
```

---

## Publishing

```bash
npx nx build auth-microsoft
cd packages/auth-microsoft
npm publish --access public
```
