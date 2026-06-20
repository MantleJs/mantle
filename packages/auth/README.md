# @mantlejs/auth

JWT authentication engine for [Mantle JS](https://github.com/mantlejs/mantle). Provides token issuance, verification, a strategy runner, and hook utilities. Designed to be paired with a strategy package such as [`@mantlejs/auth-local`](../auth-local/README.md).

---

## Installation

```bash
npm install @mantlejs/auth jsonwebtoken
```

---

## Concepts

### The authentication engine

`auth()` is a Mantle plugin. It registers an `AuthEngine` on the application and mounts a built-in `authentication` service at `POST /authentication`. The engine is the single source of truth for JWT configuration and strategy dispatch — strategy packages (like `auth-local`) register themselves into it.

### Strategies

A strategy is an object with a `name` and an `authenticate(data, params)` method. The engine calls the matching strategy when `POST /authentication` arrives with a `strategy` field in the body. Strategy packages call `engine.registerStrategy(strategy)` during their own plugin registration.

### Hooks

`authenticate('jwt')` is a `before` hook that reads `Authorization: Bearer <token>` from the request headers, verifies the token, and writes the decoded payload to `params.user`.

`sanitizeUser()` is an `after` hook that strips sensitive fields (password, passwordHash) from service results before they leave the server.

### Internal calls

Hooks registered with `authenticate('jwt')` automatically skip when the call has no `provider` (i.e. calls that originate within the server rather than from HTTP). This lets auth strategies query user services without tripping their own guards.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy());

app.use("/users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "patch", "remove"],
});

app.service("users").hooks({
  before: {
    create: [hashPassword()],
    find:   [authenticate("jwt")],
    get:    [authenticate("jwt")],
    patch:  [authenticate("jwt")],
    remove: [authenticate("jwt")],
  },
  after: {
    all: [sanitizeUser()],
  },
});

app.listen(3030);
```

**Register a user**

```http
POST /users
Content-Type: application/json

{ "email": "alice@example.com", "password": "hunter2" }
```

**Log in**

```http
POST /authentication
Content-Type: application/json

{ "strategy": "local", "email": "alice@example.com", "password": "hunter2" }
```

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": 1, "email": "alice@example.com" }
}
```

**Call a protected endpoint**

```http
GET /users
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

---

## API

### `auth(config)`

Returns a `MantlePlugin`. Call via `app.configure(auth(config))`.

```typescript
app.configure(auth({
  secret: process.env.JWT_SECRET!,  // required — signing key
  expiresIn: "7d",                  // optional — default "1d"
  algorithms: ["HS256"],            // optional — default ["HS256"]
  issuer: "my-api",                 // optional
  audience: "my-client",           // optional
}));
```

Side effects:
- Stores the `AuthEngine` at `app.get("auth")`
- Registers `POST /authentication` via `app.use("authentication", ...)`

#### `AuthConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `secret` | `string` | — | JWT signing secret (required) |
| `expiresIn` | `string \| number` | `"1d"` | Token lifetime. Strings use [ms](https://github.com/vercel/ms) format (`"2h"`, `"7d"`). Numbers are seconds. |
| `algorithms` | `string[]` | `["HS256"]` | Verification algorithms |
| `issuer` | `string` | — | Sets and verifies the `iss` claim |
| `audience` | `string \| string[]` | — | Sets and verifies the `aud` claim |

---

### `authenticate(strategy)`

A `before` hook factory. Returns a hook that authenticates the incoming request.

```typescript
app.service("messages").hooks({
  before: {
    all: [authenticate("jwt")],
  },
});
```

**`authenticate("jwt")`**

Reads `Authorization: Bearer <token>` from `params.headers`. On success writes the decoded JWT payload to `params.user`. On failure throws `NotAuthenticated`.

Silently skips (passes through) when `params.provider` is undefined — internal service calls are trusted.

**`authenticate("custom")`**

For non-JWT strategies: delegates to `engine.authenticate(strategyName, context.data, context.params)` and writes the result to `params.user`. Skips for internal calls.

---

### `sanitizeUser(fields?)`

An `after` hook that removes sensitive fields from the service result. Works with single objects, arrays, and paginated results.

```typescript
app.service("users").hooks({
  after: {
    all: [sanitizeUser()],                         // removes password, passwordHash, password_hash
    get: [sanitizeUser(["secret", "apiKey"])],     // custom field list
  },
});
```

Default fields removed: `"password"`, `"passwordHash"`, `"password_hash"`.

---

### `AuthEngine` (advanced)

Accessed via `app.get<AuthEngine>("auth")`. Useful when writing custom strategy packages.

```typescript
const engine = app.get<AuthEngine>("auth");

// Create a token
const token = engine.createJwt({ sub: String(user.id), role: "admin" });

// Verify a token
const payload = engine.verifyJwt(token); // throws if invalid

// Register a custom strategy
engine.registerStrategy({
  name: "magic-link",
  async authenticate(data, params) {
    // verify magic link token, find user, issue JWT...
    return { accessToken: engine.createJwt({ sub: userId }) };
  },
});
```

---

### `POST /authentication`

The built-in authentication endpoint. Dispatches to a registered strategy based on the `strategy` field.

**Request**

```json
{
  "strategy": "local",
  "email": "alice@example.com",
  "password": "hunter2"
}
```

**Response** (`201 Created`)

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "id": 1, "email": "alice@example.com" }
}
```

**Errors**

| Status | Condition |
| --- | --- |
| `400 Bad Request` | `strategy` field missing |
| `400 Bad Request` | Strategy name not registered |
| `401 Not Authenticated` | Strategy-specific failure (wrong password, user not found, etc.) |

---

## Types

```typescript
import type {
  AuthConfig,
  AuthEngine,
  AuthResult,
  AuthStrategy,
  JwtPayload,
} from "@mantlejs/auth";
```

| Type | Description |
| --- | --- |
| `AuthConfig` | Options passed to `auth()` |
| `AuthEngine` | The engine stored at `app.get("auth")` |
| `AuthResult` | `{ accessToken: string; [key: string]: unknown }` — returned by strategies |
| `AuthStrategy` | Interface to implement for custom strategies |
| `JwtPayload` | Decoded JWT payload shape |

---

## Writing a custom strategy

```typescript
import type { MantlePlugin } from "@mantlejs/core";
import type { AuthEngine, AuthStrategy } from "@mantlejs/auth";

export function magicLinkStrategy(): MantlePlugin {
  return (app) => {
    const engine = app.get<AuthEngine>("auth");
    if (!engine) throw new Error("@mantlejs/auth must be configured first");

    const strategy: AuthStrategy = {
      name: "magic-link",
      async authenticate(data) {
        // 1. Validate data.token against your store
        // 2. Look up the user
        // 3. Return the JWT
        const accessToken = engine.createJwt({ sub: String(userId) });
        return { accessToken, user };
      },
    };

    engine.registerStrategy(strategy);
  };
}
```

Register it alongside your other plugins:

```typescript
app
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(magicLinkStrategy());
```

---

## Error reference

All errors extend `MantleError` and serialize to JSON automatically.

| Error | Code | When thrown |
| --- | --- | --- |
| `NotAuthenticated` | 401 | Missing/invalid/expired Bearer token |
| `BadRequest` | 400 | `strategy` field missing from `POST /authentication` |
| `BadRequest` | 400 | Named strategy not registered |

---

## Development

```bash
npx nx build auth     # compile
npx nx test auth      # run tests
npx nx lint auth      # lint
```
