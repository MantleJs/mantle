# @mantlejs/auth-apple

Sign in with Apple strategy for [Mantle JS](https://github.com/mantlejs/mantle). Implements the authorization code flow with `response_mode=form_post` — no Passport.js dependency. Registers `GET /auth/apple` and `POST /auth/apple/callback` on the HTTP transport, then finds or creates a user record and returns a Mantle JWT pair.

---

## Installation

```bash
npm install @mantlejs/auth-apple
```

---

## Concepts

### No static client secret

Apple does not issue a client secret. Instead, every token exchange is authenticated with a short-lived ES256 JWT signed from your Sign in with Apple private key (the `.p8` file). [Arctic](https://arcticjs.dev) signs this JWT per exchange (see [ADR-002](../../docs/decisions/adr-002-arctic-oauth-internals.md)) — you configure `teamId`, `keyId`, and `privateKey` instead of a `clientSecret`.

### POST callback

Whenever the `name`/`email` scopes are requested, Apple requires `response_mode=form_post`: the callback arrives as an `application/x-www-form-urlencoded` **POST** rather than a GET redirect. CSRF protection is the `state` round-trip through the `OAuthStateStore` (Apple does not support PKCE for this flow).

### Profile from the id_token

Apple has no userinfo endpoint. The profile comes from the id_token returned by the token exchange: `sub` becomes the user ID, `email` the email. The id_token is obtained directly from Apple's token endpoint over TLS, so its payload is decoded without a JWKS round-trip.

### First-login name capture

Apple sends the user's name in a `user` form field on the **first** authorization only. The plugin reads it into the profile, and find-or-create persists it when the user record is created — subsequent logins without the field lose nothing.

### Find-or-create

On callback the plugin searches the configured user service for a record where `appleId` (configurable) matches the id_token's `sub` claim. If no record is found, it creates one with `{ appleId, email, name }` from the profile. The same user is returned on every subsequent sign-in.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { appleStrategy } from "@mantlejs/auth-apple";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(
    appleStrategy({
      clientId: process.env.APPLE_CLIENT_ID!, // Services ID, e.g. "com.example.app.web"
      teamId: process.env.APPLE_TEAM_ID!,
      keyId: process.env.APPLE_KEY_ID!,
      privateKey: process.env.APPLE_PRIVATE_KEY!, // PEM contents of the .p8 key
    }),
  );

app.listen(3030);
```

**Sign-in flow:**

1. Redirect the browser to `GET /auth/apple`
2. User authenticates with Apple and consents
3. Apple POSTs `code`, `state` (and `user` on first login) to `/auth/apple/callback`
4. The plugin exchanges the code, decodes the id_token, finds or creates the user, and responds:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "appleId": "001234.abc...", "email": "alice@icloud.com", "name": "Alice Doe" }
}
```

---

## API

### `appleStrategy(config)`

```typescript
function appleStrategy(config: AppleStrategyConfig): MantlePlugin;

type AppleStrategyConfig = {
  clientId: string; // Services ID (the OAuth client_id)
  teamId: string; // Apple Developer Team ID
  keyId: string; // Key ID of the Sign in with Apple private key
  privateKey: string; // PKCS#8 PEM contents of the .p8 key
  callbackUrl?: string; // Default: '/auth/apple/callback'
  scope?: string[]; // Default: ['name', 'email']
  entity?: string; // Default: 'users'
  entityIdField?: string; // Default: 'appleId'
};
```

| Field           | Type       | Default                  | Description                                                         |
| --------------- | ---------- | ------------------------ | ------------------------------------------------------------------- |
| `clientId`      | `string`   | —                        | Services ID from the Apple Developer portal (required)              |
| `teamId`        | `string`   | —                        | Apple Developer Team ID (required)                                  |
| `keyId`         | `string`   | —                        | Key ID of the Sign in with Apple key (required)                     |
| `privateKey`    | `string`   | —                        | PEM contents of the downloaded `.p8` private key (required)         |
| `callbackUrl`   | `string`   | `'/auth/apple/callback'` | Callback path — must match the Return URL registered with Apple     |
| `scope`         | `string[]` | `['name', 'email']`      | Sign in with Apple scopes                                           |
| `entity`        | `string`   | `'users'`                | Mantle service used to find or create users                         |
| `entityIdField` | `string`   | `'appleId'`              | Field on the user record matched against the id_token's `sub` claim |

**Routes registered:**

| Method | Path                   | Description                                          |
| ------ | ---------------------- | ---------------------------------------------------- |
| `GET`  | `/auth/apple`          | Redirect to Apple's sign-in page                     |
| `POST` | `/auth/apple/callback` | Handle the form_post callback, issue Mantle JWT pair |

**Must be configured after** an HTTP transport and `auth()`.

---

## Types

```typescript
import type { AppleStrategyConfig } from "@mantlejs/auth-apple";
```

`AppleStrategyConfig` extends `OAuthPluginConfig` from `@mantlejs/auth-oauth`, replacing `clientSecret` with `teamId`/`keyId`/`privateKey`.

---

## Apple Developer setup

1. In [developer.apple.com](https://developer.apple.com/account), create an **App ID** with the Sign in with Apple capability
2. Create a **Services ID** (this is your `clientId`) and enable Sign in with Apple for it
3. Register your domain and Return URL: `https://your-domain.com/auth/apple/callback` (Apple requires HTTPS — no localhost)
4. Create a **Sign in with Apple key**, download the `.p8` file (one-time download), and note its **Key ID**
5. Find your **Team ID** on the membership page

---

## Development

```bash
npx nx build auth-apple   # compile
npx nx test auth-apple    # run tests
npx nx lint auth-apple    # lint
```

---

## Publishing

```bash
npx nx build auth-apple
cd packages/auth-apple
npm publish --access public
```
