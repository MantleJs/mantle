# @mantlejs/auth-linkedin

LinkedIn Sign-In (OpenID Connect) strategy for [Mantle JS](https://github.com/mantlejs/mantle). Implements the authorization code flow — no Passport.js dependency. Registers `GET /auth/linkedin` and `GET /auth/linkedin/callback` on the HTTP transport, then finds or creates a user record and returns a Mantle JWT pair.

---

## Installation

```bash
npm install @mantlejs/auth-linkedin
```

---

## Concepts

### OpenID Connect

This strategy uses LinkedIn's **"Sign In with LinkedIn using OpenID Connect"** product — the legacy `r_liteprofile`/v2 profile API is not touched. Enable this product on your LinkedIn developer app before using this package.

### No PKCE

Unlike the Google and Microsoft strategies, LinkedIn's authorization code flow authenticates the token exchange with the client secret only. CSRF protection comes from the `state` round-trip through the configured `OAuthStateStore` — the same posture as the GitHub and Facebook strategies.

### Find-or-create

On callback the plugin searches the configured user service for a record where `linkedinId` (configurable) matches the `sub` claim from LinkedIn's OIDC userinfo endpoint. If no record is found, it creates one with `{ linkedinId, email, name }` from the profile. The same user is returned on every subsequent sign-in.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { linkedinStrategy } from "@mantlejs/auth-linkedin";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(
    linkedinStrategy({
      clientId: process.env.LINKEDIN_CLIENT_ID!,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  );

app.listen(3030);
```

**Sign-in flow:**

1. Redirect the browser to `GET /auth/linkedin`
2. User authenticates on LinkedIn and consents
3. LinkedIn redirects to `GET /auth/linkedin/callback?code=...&state=...`
4. The plugin exchanges the code, fetches the profile, finds or creates the user, and responds:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "linkedinId": "AAAA...", "email": "alice@example.com", "name": "Alice" }
}
```

---

## API

### `linkedinStrategy(config)`

```typescript
function linkedinStrategy(config: LinkedInStrategyConfig): MantlePlugin;

type LinkedInStrategyConfig = OAuthPluginConfig; // no provider-specific fields
```

| Field           | Type       | Default                           | Description                                                                 |
| --------------- | ---------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `clientId`      | `string`   | —                                  | LinkedIn app client ID (required)                                                   |
| `clientSecret`  | `string`   | —                                  | LinkedIn app client secret (required)                                               |
| `callbackUrl`   | `string`   | `'/auth/linkedin/callback'`        | Callback path — must match the redirect URI registered on the LinkedIn app          |
| `scope`         | `string[]` | `['openid', 'profile', 'email']`   | LinkedIn OAuth scopes                                                               |
| `entity`        | `string`   | `'users'`                          | Mantle service used to find or create users                                         |
| `entityIdField` | `string`   | `'linkedinId'`                     | Field on the user record matched against LinkedIn's `sub` claim                     |

**Routes registered:**

| Method | Path                      | Description                            |
| ------ | ------------------------- | --------------------------------------- |
| `GET`  | `/auth/linkedin`          | Redirect to LinkedIn sign-in            |
| `GET`  | `/auth/linkedin/callback` | Handle callback, issue Mantle JWT pair  |

**Must be configured after** the transport (e.g. `express()`) and `auth()`.

---

## Types

```typescript
import type { LinkedInStrategyConfig } from "@mantlejs/auth-linkedin";
```

`LinkedInStrategyConfig` is `OAuthPluginConfig` from `@mantlejs/auth-oauth` — LinkedIn has no provider-specific config.

---

## LinkedIn developer app setup

1. Create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)
2. Under **Products**, request access to **"Sign In with LinkedIn using OpenID Connect"**
3. Under **Auth**, add an **Authorized redirect URL**: `https://your-domain.com/auth/linkedin/callback`
4. Copy the **Client ID** and **Client Secret** into your environment

---

## Development

```bash
npx nx build auth-linkedin   # compile
npx nx test auth-linkedin    # run tests
npx nx lint auth-linkedin    # lint
```

---

## Publishing

```bash
npx nx build auth-linkedin
cd packages/auth-linkedin
npm publish --access public
```
