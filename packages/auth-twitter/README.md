# @mantlejs/auth-twitter

Sign in with X (Twitter) OAuth 2.0 strategy for [Mantle JS](https://github.com/mantlejs/mantle). Implements the authorization code flow with PKCE — no Passport.js dependency. Registers `GET /auth/twitter` and `GET /auth/twitter/callback` on the HTTP transport, then finds or creates a user record and returns a Mantle JWT pair.

---

## Installation

```bash
npm install @mantlejs/auth-twitter
```

---

## Concepts

### PKCE

Unlike `auth-github`/`auth-facebook`/`auth-linkedin`, X's OAuth 2.0 implementation requires PKCE (Proof Key for Code Exchange) — same posture as `auth-google`/`auth-microsoft`. On each redirect request the plugin generates a fresh `code_verifier` (via [Arctic](https://arcticjs.dev), which also derives the SHA-256 / base64url `code_challenge` — see [ADR-002](../../docs/decisions/adr-002-arctic-oauth-internals.md)). The verifier is stored server-side against a random `state` token and passed to the token exchange on callback.

### Scope

Defaults to `["users.read", "tweet.read"]`. X's own API reference lists `users.read` and `tweet.read` as alternative scopes for `GET /2/users/me`, but X's developer community has repeatedly reported `403 Forbidden` from that endpoint with `users.read` alone — both are requested by default to match what's actually been confirmed working, not just what the reference documents.

### No email

X's `/2/users/me` endpoint only returns an email address via the `confirmed_email` field, gated behind an app-level email access grant that most apps don't have, and never includes it by default. This strategy doesn't request `user.fields=confirmed_email` (an unapproved field risks the whole call failing rather than being silently omitted), so a user record created via `twitterStrategy` never has an `email` — plan your `users` schema accordingly if X is one of several strategies you support.

### Find-or-create

On callback the plugin searches the configured user service for a record where `twitterId` (configurable) matches the `id` field from X's `/2/users/me` response. If no record is found, it creates one with `{ twitterId, name }` from the profile (no `email` — see above). The same user is returned on every subsequent sign-in.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { twitterStrategy } from "@mantlejs/auth-twitter";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(
    twitterStrategy({
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
    }),
  );

app.listen(3030);
```

**Sign-in flow:**

1. Redirect the browser to `GET /auth/twitter`
2. User authenticates on X and consents
3. X redirects to `GET /auth/twitter/callback?code=...&state=...`
4. The plugin exchanges the code, fetches the profile, finds or creates the user, and responds:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "twitterId": "1234567890", "name": "Alice" }
}
```

---

## API

### `twitterStrategy(config)`

```typescript
function twitterStrategy(config: TwitterStrategyConfig): MantlePlugin;

type TwitterStrategyConfig = OAuthPluginConfig;
```

| Field           | Type       | Default                        | Description                                                                                                                                   |
| --------------- | ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientId`      | `string`   | —                                | X app's OAuth 2.0 Client ID (required)                                                                                                         |
| `clientSecret`  | `string`   | —                                | X app's OAuth 2.0 Client Secret (required)                                                                                                     |
| `callbackUrl`   | `string`   | `'/auth/twitter/callback'`      | Callback path — must match a redirect URI registered in the X app's settings                                                                  |
| `scope`         | `string[]` | `['users.read', 'tweet.read']`  | X OAuth 2.0 scopes                                                                                                                              |
| `entity`        | `string`   | `'users'`                       | Mantle service used to find or create users                                                                                                    |
| `entityIdField` | `string`   | `'twitterId'`                   | Field on the user record matched against X's `id` field                                                                                        |
| `redirectUrl`   | `string`   | none — returns JSON             | Frontend URL to redirect to on completion, with tokens (or an error) in the URL fragment — see [`@mantlejs/auth-oauth`](../auth-oauth/README.md#redirecting-back-to-a-frontend-redirecturl) |

**Routes registered:**

| Method | Path                     | Description                            |
| ------ | ------------------------ | --------------------------------------- |
| `GET`  | `/auth/twitter`          | Redirect to X sign-in                  |
| `GET`  | `/auth/twitter/callback` | Handle callback, issue Mantle JWT pair |

**Must be configured after** the transport (e.g. `express()`) and `auth()`.

---

## Types

```typescript
import type { TwitterStrategyConfig } from "@mantlejs/auth-twitter";
```

`TwitterStrategyConfig` is a plain alias of `OAuthPluginConfig` from `@mantlejs/auth-oauth` — X needs no strategy-specific fields (unlike `auth-microsoft`'s `tenant` or `auth-apple`'s Sign in with Apple key fields).

---

## X Developer Portal setup

1. Create a project and app at [developer.x.com](https://developer.x.com) → **Developer Portal**
2. Under your app's **User authentication settings**, enable **OAuth 2.0** and set the app type to **Web App**
3. Add a callback URI: `https://your-domain.com/auth/twitter/callback`
4. Under **App permissions**, request at least **Read** access
5. Copy the **OAuth 2.0 Client ID** and generate a **Client Secret** into your environment

---

## Development

```bash
npx nx build auth-twitter   # compile
npx nx test auth-twitter    # run tests
npx nx lint auth-twitter    # lint
```

---

## Publishing

```bash
npx nx build auth-twitter
cd packages/auth-twitter
npm publish --access public
```
