# OAuth Strategy Design: Mantle vs FeathersJS

Comparison of `@mantlejs/auth-github` / `@mantlejs/auth-google` against `@feathersjs/authentication-oauth`, with side-by-side usage examples and justification for Mantle's separate-package approach.

---

## Architecture Overview

| Dimension | Mantle JS | FeathersJS v5 |
|---|---|---|
| Package model | One npm package per provider (`auth-github`, `auth-google`) | Single `@feathersjs/authentication-oauth` covers all providers |
| Provider registry | Each package hard-codes its own endpoints | [`grant`](https://github.com/simov/grant) library ships a registry of 200+ providers |
| Extension model | Implement the `OAuthProvider` interface (plain object, no classes) | Subclass `OAuthStrategy` and override `getEntityData` |
| PKCE support | Per-provider opt-in (`usePkce: boolean` on `OAuthProvider`) | Not supported natively |
| Route path | `/auth/{provider}` and `/auth/{provider}/callback` | `/oauth/{provider}` and `/oauth/{provider}/callback` |
| State/CSRF | In-process `Map` with TTL, managed by `createStateStore()` | Managed by `grant` (session-based) |
| Passport.js dependency | None | None (v5 dropped Passport; v4 required it) |
| Token response | `{ accessToken, refreshToken, user }` via `res.json()` | Redirect with token in query string or cookie |
| Framework coupling | Requires `@mantlejs/express` and `@mantlejs/auth` | Requires `@feathersjs/express` and `@feathersjs/authentication` |

---

## Usage Examples — GitHub

### FeathersJS v5

```typescript
// src/authentication.ts
import { AuthenticationService, JWTStrategy } from "@feathersjs/authentication";
import { OAuthStrategy, oauth } from "@feathersjs/authentication-oauth";

class GitHubStrategy extends OAuthStrategy {
  async getEntityData(profile: any) {
    const base = await super.getEntityData(profile);
    return {
      ...base,
      githubId: profile.id,
      email: profile.emails?.[0]?.value ?? profile.email,
      name: profile.displayName,
    };
  }
}

export const authentication = (app: Application) => {
  const authService = new AuthenticationService(app);
  authService.register("jwt", new JWTStrategy());
  authService.register("github", new GitHubStrategy());

  app.use("/authentication", authService);
  app.configure(oauth()); // mounts /oauth/github and /oauth/github/callback via grant
};
```

```json
// config/default.json — provider credentials live in config, not code
{
  "authentication": {
    "secret": "your-jwt-secret",
    "entity": "user",
    "service": "users",
    "authStrategies": ["jwt"],
    "oauth": {
      "redirect": "/",
      "github": {
        "key": "your-github-client-id",
        "secret": "your-github-client-secret",
        "scope": ["user:email"]
      }
    }
  }
}
```

**Routes registered by `grant`:** `GET /oauth/github` → `GET /oauth/github/callback`

### Mantle JS

```typescript
// server.ts
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
      // optional overrides:
      // scope: ["read:user", "user:email"],
      // entity: "users",
      // entityIdField: "githubId",
      // callbackUrl: "/auth/github/callback",
    }),
  );

app.use("/users", new UserService(new UserRepository(app)));

app.listen(3030);
```

**Routes registered:** `GET /auth/github` → `GET /auth/github/callback`

**Callback response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "githubId": "12345", "email": "alice@github.com", "name": "Alice" }
}
```

---

## Usage Examples — Google

### FeathersJS v5

```typescript
// src/authentication.ts
import { AuthenticationService, JWTStrategy } from "@feathersjs/authentication";
import { OAuthStrategy, oauth } from "@feathersjs/authentication-oauth";

class GoogleStrategy extends OAuthStrategy {
  async getEntityData(profile: any) {
    const base = await super.getEntityData(profile);
    return {
      ...base,
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      name: profile.displayName,
    };
  }
}

export const authentication = (app: Application) => {
  const authService = new AuthenticationService(app);
  authService.register("jwt", new JWTStrategy());
  authService.register("google", new GoogleStrategy());

  app.use("/authentication", authService);
  app.configure(oauth());
};
```

```json
// config/default.json
{
  "authentication": {
    "secret": "your-jwt-secret",
    "entity": "user",
    "service": "users",
    "authStrategies": ["jwt"],
    "oauth": {
      "redirect": "/",
      "google": {
        "key": "your-google-client-id",
        "secret": "your-google-client-secret",
        "scope": ["openid", "email", "profile"]
      }
    }
  }
}
```

**Routes registered by `grant`:** `GET /oauth/google` → `GET /oauth/google/callback`

### Mantle JS

```typescript
// server.ts
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { googleStrategy } from "@mantlejs/auth-google";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(
    googleStrategy({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // optional overrides:
      // scope: ["openid", "profile", "email"],
      // entity: "users",
      // entityIdField: "googleId",
      // callbackUrl: "/auth/google/callback",
    }),
  );

app.use("/users", new UserService(new UserRepository(app)));

app.listen(3030);
```

**Routes registered:** `GET /auth/google` → `GET /auth/google/callback`

**Callback response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": "1", "googleId": "108421...", "email": "alice@gmail.com", "name": "Alice" }
}
```

---

## Adding Both Providers Together

### FeathersJS v5

Both strategies are registered on the same `AuthenticationService` and both sets of credentials live in the shared config block. Adding a second provider requires no additional install.

```typescript
authService.register("github", new GitHubStrategy());
authService.register("google", new GoogleStrategy());
```

```json
{
  "authentication": {
    "oauth": {
      "github": { "key": "...", "secret": "..." },
      "google": { "key": "...", "secret": "..." }
    }
  }
}
```

### Mantle JS

Each provider is an independent `.configure()` call. Each can be installed or removed without touching any other package.

```typescript
import { githubStrategy } from "@mantlejs/auth-github";
import { googleStrategy } from "@mantlejs/auth-google";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(githubStrategy({ clientId: "...", clientSecret: "..." }))
  .configure(googleStrategy({ clientId: "...", clientSecret: "..." }));
```

---

## Key Differences

### 1. Extension model: interface vs inheritance

FeathersJS requires subclassing `OAuthStrategy`. This is idiomatic for class-heavy frameworks but introduces coupling to the base class implementation and makes the customization surface implicit (which methods exist, which are safe to override).

Mantle uses the `OAuthProvider` plain-object interface. Each provider package is a value that satisfies a contract — no inheritance, no hidden super-method behavior. The full HTTP surface for a provider is visible in one file.

### 2. Provider registry: `grant` vs explicit implementation

FeathersJS delegates endpoint discovery and OAuth flow mechanics to the `grant` library, which ships a built-in registry of 200+ providers. This is powerful for rapid setup of any well-known provider. The trade-off is a large transitive dependency with its own session management, config schema, and redirect behavior that the application developer cannot easily override.

Mantle implements each provider's endpoint URLs, request format, and profile parsing directly in the package source. This makes the HTTP contract auditable, testable in isolation, and not subject to changes in a third-party registry.

### 3. PKCE support

Google's current security guidelines recommend PKCE for all authorization code flows, even server-side apps. Mantle's `@mantlejs/auth-google` generates a `code_verifier` / `code_challenge` pair on every authorization request. GitHub does not support PKCE for server-side flows, so `@mantlejs/auth-github` opts out via `usePkce: false` on the `OAuthProvider` object.

`@feathersjs/authentication-oauth` / `grant` does not support PKCE natively.

### 4. Token delivery

FeathersJS (via `grant`) defaults to redirecting the browser to a configured URL with the token embedded in the query string or stored in a cookie — a pattern suited to server-rendered or SPA frontends that consume the redirect directly.

Mantle responds with `res.json({ accessToken, refreshToken, user })` on the callback route. This suits SPA or mobile clients that drive the OAuth flow through a popup/redirect and then consume the JSON response programmatically.

### 5. Configuration location

FeathersJS uses a `config/default.json` file (via `@feathersjs/configuration`) to hold credentials and OAuth options. This separates provider config from code but requires the Feathers config system.

Mantle passes credentials directly in the `.configure()` call, keeping them in the same place as any other environment-driven configuration (`process.env.*`). There is no secondary config file format to learn.

---

## Justification for Separate Packages in Mantle

### Install only what you use

An application that authenticates with GitHub only installs `@mantlejs/auth-github`. It does not pull in the 200-provider registry from `grant`, session middleware, or Google's client library. Bundle size and dependency surface stay proportional to what the application actually needs.

### Per-provider versioning and security updates

Each provider package can be patched independently. A breaking change in GitHub's token endpoint format, a new required header, or a security advisory requires a patch to `@mantlejs/auth-github@x.y.z` only — not a release of the entire OAuth package that could affect all providers in production at once.

### Testability and auditability

The entire GitHub OAuth flow — URL construction, code exchange, profile fetch, find-or-create — is visible in `packages/auth-github/src/lib/github-strategy.ts`. There is no inherited behavior and no third-party HTTP adapter to trace through. A security audit of "what does this package do with my GitHub credentials" has a single, short file to inspect.

### Clean dependency graph

The `@nx/enforce-module-boundaries` rule enforces that `@mantlejs/auth-github` may only depend on `@mantlejs/mantle` and `@mantlejs/auth-oauth`. This is expressible in a per-package rule precisely because each provider is its own package. A single monolithic `@mantlejs/auth-oauth` for all providers would not allow this level of granularity.

### Precedent in the ecosystem

This pattern is established at scale: `passport-github2` and `passport-google-oauth20` are separate packages despite Passport itself being a single framework. The `next-auth` ecosystem moved the same direction in v5 (Auth.js), publishing `@auth/github-adapter`, `@auth/google-adapter`, etc. as separate publishable units.

---

## Summary

| Question | Mantle | FeathersJS |
|---|---|---|
| Which install adds Google support? | `npm install @mantlejs/auth-google` | No additional install — `@feathersjs/authentication-oauth` covers it |
| How many lines to wire up GitHub? | ~6 (one `.configure()` call) | ~8 (subclass + register + config JSON block) |
| Does it support PKCE for Google? | Yes | No |
| Is the OAuth flow auditable in one file? | Yes | No — split across `OAuthStrategy`, `grant`, and config |
| Can providers be versioned independently? | Yes | No — all providers move with the single package |
| Can you add a custom provider? | Yes — implement `OAuthProvider` interface | Yes — subclass `OAuthStrategy` |
