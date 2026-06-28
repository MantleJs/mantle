# @mantlejs/auth-google

Google OAuth 2.0 strategy for [Mantle JS](https://github.com/mantlejs/mantle). Implements the authorization code flow with PKCE — no Passport.js dependency. Registers `GET /auth/google` and `GET /auth/google/callback` on the Express app, then finds or creates a user record and returns a Mantle JWT pair.

---

## Installation

```bash
npm install @mantlejs/auth-google
```

---

## Concepts

### PKCE

Google Sign-In uses the authorization code flow with PKCE (Proof Key for Code Exchange). On each redirect request the plugin generates a fresh `code_verifier` and its `code_challenge` (SHA-256 / base64url). The verifier is stored server-side against a random `state` token and passed to the token exchange on callback.

### Find-or-create

On callback the plugin searches the configured user service for a record where `googleId` (configurable) matches the `sub` claim from Google's userinfo endpoint. If no record is found, it creates one with `{ googleId, email, name }` from the profile. The same user is returned on every subsequent sign-in.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { googleStrategy } from "@mantlejs/auth-google";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(googleStrategy({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  }));

app.listen(3030);
```

**Sign-in flow:**

1. Redirect the browser to `GET /auth/google`
2. User authenticates on Google and consents
3. Google redirects to `GET /auth/google/callback?code=...&state=...`
4. The plugin exchanges the code, fetches the profile, finds or creates the user, and responds:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "googleId": "108...", "email": "alice@gmail.com", "name": "Alice" }
}
```

---

## API

### `googleStrategy(config)`

```typescript
function googleStrategy(config: GoogleStrategyConfig): MantlePlugin;

type GoogleStrategyConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string;    // Default: '/auth/google/callback'
  scope?: string[];        // Default: ['openid', 'profile', 'email']
  entity?: string;         // Default: 'users'
  entityIdField?: string;  // Default: 'googleId'
};
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `clientId` | `string` | — | Google OAuth client ID (required) |
| `clientSecret` | `string` | — | Google OAuth client secret (required) |
| `callbackUrl` | `string` | `'/auth/google/callback'` | Callback path — must match the redirect URI registered in Google Cloud Console |
| `scope` | `string[]` | `['openid', 'profile', 'email']` | Google OAuth scopes |
| `entity` | `string` | `'users'` | Mantle service used to find or create users |
| `entityIdField` | `string` | `'googleId'` | Field on the user record matched against Google's `sub` claim |

**Routes registered:**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/google` | Redirect to Google consent screen |
| `GET` | `/auth/google/callback` | Handle callback, issue Mantle JWT pair |

**Must be configured after** `express()` and `auth()`.

---

## Types

```typescript
import type { GoogleStrategyConfig } from "@mantlejs/auth-google";
```

`GoogleStrategyConfig` is an alias for `OAuthPluginConfig` from `@mantlejs/auth-oauth`.

---

## Google Cloud Console setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Google+ API** (or **People API**)
3. Create OAuth 2.0 credentials (Web application)
4. Add the callback URL to **Authorized redirect URIs**: `https://your-domain.com/auth/google/callback`
5. Copy the **Client ID** and **Client Secret** into your environment

---

## Development

```bash
npx nx build auth-google   # compile
npx nx test auth-google    # run tests
npx nx lint auth-google    # lint
```

---

## Publishing

```bash
npx nx build auth-google
cd packages/auth-google
npm publish --access public
```
