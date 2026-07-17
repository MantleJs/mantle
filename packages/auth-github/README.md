# @mantlejs/auth-github

GitHub OAuth 2.0 strategy for [Mantle JS](https://github.com/mantlejs/mantle). Implements the authorization code flow — no Passport.js dependency. Registers `GET /auth/github` and `GET /auth/github/callback` on the Express app, then finds or creates a user record and returns a Mantle JWT pair.

---

## Installation

```bash
npm install @mantlejs/auth-github
```

---

## Concepts

### Authorization code flow

GitHub Sign-In uses the standard authorization code flow (without PKCE — GitHub does not support it for server-side apps). On each redirect request the plugin generates a random `state` token stored server-side for CSRF protection and passed through the OAuth exchange. URL construction and token exchange go through [Arctic](https://arcticjs.dev) (see [ADR-002](../../docs/decisions/adr-002-arctic-oauth-internals.md)); the token request authenticates with HTTP Basic credentials.

### Find-or-create

On callback the plugin searches the configured user service for a record where `githubId` (configurable) matches the `id` field from GitHub's `/user` endpoint. If no record is found, it creates one with `{ githubId, email, name }` from the profile. The same user is returned on every subsequent sign-in.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { githubStrategy } from "@mantlejs/auth-github";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(
    githubStrategy({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  );

app.listen(3030);
```

**Sign-in flow:**

1. Redirect the browser to `GET /auth/github`
2. User authenticates on GitHub and consents
3. GitHub redirects to `GET /auth/github/callback?code=...&state=...`
4. The plugin exchanges the code, fetches the profile, finds or creates the user, and responds:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "githubId": "12345", "email": "alice@github.com", "name": "Alice" }
}
```

---

## API

### `githubStrategy(config)`

```typescript
function githubStrategy(config: GitHubStrategyConfig): MantlePlugin;

type GitHubStrategyConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string; // Default: '/auth/github/callback'
  scope?: string[]; // Default: ['read:user', 'user:email']
  entity?: string; // Default: 'users'
  entityIdField?: string; // Default: 'githubId'
};
```

| Field           | Type       | Default                       | Description                                                                                   |
| --------------- | ---------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `clientId`      | `string`   | —                             | GitHub OAuth App client ID (required)                                                         |
| `clientSecret`  | `string`   | —                             | GitHub OAuth App client secret (required)                                                     |
| `callbackUrl`   | `string`   | `'/auth/github/callback'`     | Callback path — must match the Authorization callback URL registered in your GitHub OAuth App |
| `scope`         | `string[]` | `['read:user', 'user:email']` | GitHub OAuth scopes                                                                           |
| `entity`        | `string`   | `'users'`                     | Mantle service used to find or create users                                                   |
| `entityIdField` | `string`   | `'githubId'`                  | Field on the user record matched against GitHub's `id` value                                  |

**Routes registered:**

| Method | Path                    | Description                            |
| ------ | ----------------------- | -------------------------------------- |
| `GET`  | `/auth/github`          | Redirect to GitHub consent screen      |
| `GET`  | `/auth/github/callback` | Handle callback, issue Mantle JWT pair |

**Must be configured after** `express()` and `auth()`.

---

## Types

```typescript
import type { GitHubStrategyConfig } from "@mantlejs/auth-github";
```

`GitHubStrategyConfig` is an alias for `OAuthPluginConfig` from `@mantlejs/auth-oauth`.

---

## GitHub OAuth App setup

1. Go to **Settings → Developer settings → OAuth Apps** at [github.com](https://github.com)
2. Click **New OAuth App**
3. Set the **Authorization callback URL** to `https://your-domain.com/auth/github/callback`
4. Copy the **Client ID** and generate a **Client Secret**
5. Add both to your environment variables

---

## Development

```bash
npx nx build auth-github   # compile
npx nx test auth-github    # run tests
npx nx lint auth-github    # lint
```

---

## Publishing

```bash
npx nx build auth-github
cd packages/auth-github
npm publish --access public
```
