# @mantlejs/auth-facebook

Facebook OAuth 2.0 strategy for [Mantle JS](https://github.com/mantlejs/mantle). Implements the authorization code flow — no Passport.js dependency. Registers `GET /auth/facebook` and `GET /auth/facebook/callback` on the Express app, then finds or creates a user record and returns a Mantle JWT pair.

---

## Installation

```bash
npm install @mantlejs/auth-facebook
```

---

## Concepts

### Authorization code flow

Facebook Sign-In uses the standard OAuth 2.0 authorization code flow (without PKCE — Facebook does not require it for server-side apps). On redirect the plugin builds the authorization URL with a random `state` token to prevent CSRF. The state is verified on callback before the code is exchanged. URL construction and token exchange go through [Arctic](https://arcticjs.dev), which pins the Graph API version (see [ADR-002](../../docs/decisions/adr-002-arctic-oauth-internals.md)).

### Find-or-create

On callback the plugin searches the configured user service for a record where `facebookId` (configurable) matches the `id` from Facebook's Graph API `/me` endpoint. If no record is found, it creates one with `{ facebookId, email, name }` from the profile. The same user is returned on every subsequent sign-in.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { facebookStrategy } from "@mantlejs/auth-facebook";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(
    facebookStrategy({
      clientId: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
    }),
  );

app.listen(3030);
```

**Sign-in flow:**

1. Redirect the browser to `GET /auth/facebook`
2. User authenticates on Facebook and consents
3. Facebook redirects to `GET /auth/facebook/callback?code=...&state=...`
4. The plugin exchanges the code, fetches the profile, finds or creates the user, and responds:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "facebookId": "123456789", "email": "alice@example.com", "name": "Alice" }
}
```

---

## API

### `facebookStrategy(config)`

```typescript
function facebookStrategy(config: FacebookStrategyConfig): MantlePlugin;

type FacebookStrategyConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string; // Default: '/auth/facebook/callback'
  scope?: string[]; // Default: ['email', 'public_profile']
  entity?: string; // Default: 'users'
  entityIdField?: string; // Default: 'facebookId'
};
```

| Field           | Type       | Default                       | Description                                                                              |
| --------------- | ---------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `clientId`      | `string`   | —                             | Facebook App ID (required)                                                               |
| `clientSecret`  | `string`   | —                             | Facebook App Secret (required)                                                           |
| `callbackUrl`   | `string`   | `'/auth/facebook/callback'`   | Callback path — must match the redirect URI registered in the Facebook Developer Console |
| `scope`         | `string[]` | `['email', 'public_profile']` | Facebook OAuth permission scopes                                                         |
| `entity`        | `string`   | `'users'`                     | Mantle service used to find or create users                                              |
| `entityIdField` | `string`   | `'facebookId'`                | Field on the user record matched against Facebook's `id` field                           |

**Routes registered:**

| Method | Path                      | Description                            |
| ------ | ------------------------- | -------------------------------------- |
| `GET`  | `/auth/facebook`          | Redirect to Facebook consent screen    |
| `GET`  | `/auth/facebook/callback` | Handle callback, issue Mantle JWT pair |

**Must be configured after** `express()` and `auth()`.

---

## Types

```typescript
import type { FacebookStrategyConfig } from "@mantlejs/auth-facebook";
```

`FacebookStrategyConfig` is an alias for `OAuthPluginConfig` from `@mantlejs/auth-oauth`.

---

## Facebook Developer Console setup

1. Go to [developers.facebook.com](https://developers.facebook.com) and create an app
2. Add the **Facebook Login** product to your app
3. Under **Facebook Login > Settings**, add the callback URL to **Valid OAuth Redirect URIs**: `https://your-domain.com/auth/facebook/callback`
4. Copy the **App ID** and **App Secret** from **Settings > Basic** into your environment

---

## Development

```bash
npx nx build auth-facebook   # compile
npx nx test auth-facebook    # run tests
npx nx lint auth-facebook    # lint
```

---

## Publishing

```bash
npx nx build auth-facebook
cd packages/auth-facebook
npm publish --access public
```
