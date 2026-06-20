# @mantlejs/auth-local

Local (email + password) authentication strategy for [Mantle JS](https://github.com/mantlejs/mantle). Built on top of [`@mantlejs/auth`](../auth/README.md). Passwords are hashed with [Argon2id](https://github.com/nicowillis/argon2) via `@node-rs/argon2` — the OWASP-recommended algorithm.

---

## Installation

```bash
npm install @mantlejs/auth-local @mantlejs/auth @node-rs/argon2 jsonwebtoken
```

---

## Concepts

### `localStrategy()`

A Mantle plugin that registers a `"local"` strategy with the auth engine. When `POST /authentication` is called with `{ strategy: "local", email, password }`, it:

1. Queries the entity service (default: `"users"`) for a record matching the `usernameField`
2. Verifies the submitted password against the stored Argon2id hash
3. Issues a JWT via `engine.createJwt({ sub: String(user.id) })`
4. Returns `{ accessToken, user }`

The lookup is an internal call — it bypasses any `authenticate("jwt")` hooks on the users service.

### `hashPassword()`

A `before` hook that replaces a plain-text password field with its Argon2id hash. Run it on `create` (and `patch`/`update` if your app allows password changes) before the record reaches the database.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { knex } from "@mantlejs/knex";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";

const app = mantle()
  .configure(express())
  .configure(knex({ client: "pg", connection: process.env.DATABASE_URL }))
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy());

app.use("/users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "patch", "remove"],
});

app.service("users").hooks({
  before: {
    create: [hashPassword()],               // hash on registration
    patch:  [authenticate("jwt"), hashPassword()],  // protect + re-hash on update
    find:   [authenticate("jwt")],
    get:    [authenticate("jwt")],
    remove: [authenticate("jwt")],
  },
  after: {
    all: [sanitizeUser()],                  // strip password from all responses
  },
});

app.listen(3030);
```

---

## Usage

### Register a user

```http
POST /users
Content-Type: application/json

{ "email": "alice@example.com", "password": "hunter2" }
```

The `hashPassword()` hook runs first, so `"hunter2"` is stored as an Argon2id hash.

```json
{ "id": 1, "email": "alice@example.com" }
```

### Log in

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

Store `accessToken` client-side and include it in subsequent requests:

```http
GET /users
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

---

## API

### `localStrategy(config?)`

Returns a `MantlePlugin`. Must be called after `auth()`.

```typescript
app.configure(localStrategy({
  usernameField:  "email",    // field in the request body to match against (default: "email")
  passwordField:  "password", // field in the request body containing the plain-text password (default: "password")
  entityService:  "users",    // Mantle service name used to look up the entity (default: "users")
}));
```

#### `LocalStrategyConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `usernameField` | `string` | `"email"` | The field used to look up the user record. Must match the column name in your entity service. |
| `passwordField` | `string` | `"password"` | The field containing the submitted plain-text password. Also used to locate the stored hash in the user record. |
| `entityService` | `string` | `"users"` | Name of the registered Mantle service that holds user records. |

---

### `hashPassword(field?)`

A `before` hook that reads `context.data[field]`, hashes it with Argon2id, and writes the hash back in place.

```typescript
// Default: hashes context.data.password
app.service("users").hooks({
  before: { create: [hashPassword()] },
});

// Custom field name
app.service("accounts").hooks({
  before: { create: [hashPassword("passphrase")] },
});
```

The hook is a no-op when:

- `context.data` is `undefined`
- The target field is absent from `context.data`
- The target field value is not a string

---

## Plugin order

`localStrategy()` must be configured after `auth()` because it calls `app.get("auth")` at registration time to grab the engine and register the strategy:

```typescript
// Correct
app
  .configure(auth({ secret }))
  .configure(localStrategy());

// Wrong — throws "Auth plugin is not configured"
app
  .configure(localStrategy())
  .configure(auth({ secret }));
```

---

## Custom username field

Use any unique field as the login identifier:

```typescript
app.configure(localStrategy({ usernameField: "username" }));
```

The strategy will query `app.service("users").find({ query: { username: value } })`.

---

## Multiple user entity services

If you have more than one kind of entity that can authenticate (e.g. `users` and `admins`), register multiple strategy instances under different names by implementing a custom strategy using the `AuthEngine` directly. `localStrategy` always registers as `"local"`, so two instances would overwrite each other.

---

## Security notes

- **Argon2id** is used instead of bcrypt. Argon2id is the winner of the [Password Hashing Competition](https://www.password-hashing.net/) and is [OWASP-recommended](https://cheats.owasp.org/cheatsheets/password_storage_cheat_sheet). Unlike bcrypt, it has no 72-character password truncation limit.
- All authentication failures return the same `"Invalid credentials"` message regardless of whether the user was not found or the password was wrong. This prevents user enumeration.
- The `sanitizeUser()` hook (from `@mantlejs/auth`) strips the `password` and `passwordHash` fields from all service results. Always apply it on the `after: all` phase of your entity service.

---

## Error reference

| Error | Code | When thrown |
| --- | --- | --- |
| `NotAuthenticated` | 401 | User not found |
| `NotAuthenticated` | 401 | Password does not match stored hash |
| `NotAuthenticated` | 401 | Credentials missing from request body |
| `Error` | — | `localStrategy()` called before `auth()` (config-time failure) |

---

## Development

```bash
npx nx build auth-local     # compile
npx nx test auth-local      # run tests
npx nx lint auth-local      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build auth-local
```

First publish (scoped packages require `--access public`):

```bash
cd packages/auth-local
npm publish --access public
```

Subsequent releases — bump `version` in `packages/auth-local/package.json`, then:

```bash
cd packages/auth-local
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/auth-local
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/auth-local --registry http://localhost:4873
```
