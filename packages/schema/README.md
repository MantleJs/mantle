# @mantlejs/schema

TypeBox-based schema definition, validation, and data resolution for [Mantle JS](https://github.com/mantlejs/mantle). Re-exports the TypeBox builder so a single schema definition produces both a TypeScript type and a validated runtime contract.

---

## Installation

```bash
npm install @mantlejs/schema
```

`@sinclair/typebox` ships as a direct dependency — no separate install needed.

---

## Concepts

### One schema, two outputs

TypeBox generates a TypeScript type and a JSON Schema object from the same definition, with no build step:

```typescript
import { Type, Static } from "@mantlejs/schema";

const UserSchema = Type.Object({
  id:        Type.String({ format: "uuid" }),
  email:     Type.String({ format: "email" }),
  name:      Type.String({ minLength: 1, maxLength: 100 }),
  password:  Type.Optional(Type.String({ minLength: 8 })),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
});

type User = Static<typeof UserSchema>;
// ^ { id: string; email: string; name: string; password?: string; createdAt: string; updatedAt: string }
```

### Built-in format validation

`@mantlejs/schema` automatically registers the most common JSON Schema string formats so `validate()` checks them at runtime without any extra setup:

| Format | Example |
|---|---|
| `email` | `"alice@example.com"` |
| `date-time` | `"2024-01-15T10:30:00Z"` |
| `date` | `"2024-01-15"` |
| `uuid` | `"550e8400-e29b-41d4-a716-446655440000"` |
| `uri` | `"https://example.com"` |
| `ipv4` | `"192.168.1.1"` |
| `ipv6` | `"2001:0db8:..."` |

Custom formats can be registered via `FormatRegistry` (see [Registering custom formats](#registering-custom-formats)).

### Validation vs resolution

- **`validate()`** — runs in a `before` hook. Checks incoming data against the schema and throws `Unprocessable` with field-level errors on failure.
- **`resolver()`** — runs in an `after` hook. Transforms the result field-by-field: compute derived fields, strip sensitive data, or join related records.

---

## Quick start

```typescript
import { Type, Static } from "@mantlejs/schema";
import { validate, resolver } from "@mantlejs/schema";

const UserSchema = Type.Object({
  id:       Type.String({ format: "uuid" }),
  email:    Type.String({ format: "email" }),
  name:     Type.String({ minLength: 1 }),
  password: Type.Optional(Type.String()),
});

type User = Static<typeof UserSchema>;

app.use("/users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
  schema: UserSchema,
});

app.service("users").hooks({
  before: {
    create: [validate(UserSchema)],
    update: [validate(UserSchema)],
  },
  after: {
    all: [
      resolver<User>({
        password: () => undefined, // strip — returning undefined removes the field
      }),
    ],
  },
});
```

---

## API

### `validate(schema, options?)`

Before hook. Validates `context.data` (default), `context.result`, or `context.params.query` against a TypeBox schema. Throws `Unprocessable` with field-level error details on failure. The context target is written back when `coerce` or `stripAdditional` transforms the value.

```typescript
function validate<T extends TSchema>(schema: T, options?: ValidateOptions): HookFunction;

interface ValidateOptions {
  /** What to validate. Default: 'data' */
  target?: "data" | "result" | "query";
  /** Coerce string inputs to their schema types (e.g. "42" → 42). Default: false */
  coerce?: boolean;
  /** Strip properties not declared in the schema. Default: false */
  stripAdditional?: boolean;
}
```

```typescript
app.service("users").hooks({
  before: {
    create: [validate(UserSchema)],
    // coerce query params (strings from query string → numbers)
    find:   [validate(QuerySchema, { target: "query", coerce: true })],
  },
});
```

**Validation error format:**

```typescript
// HTTP 422 Unprocessable Entity
{
  name: "Unprocessable",
  code: 422,
  message: "Validation failed",
  data: {
    errors: [
      { field: "/email", message: "must match format \"email\"" },
      { field: "/name",  message: "must NOT have fewer than 1 characters" },
    ],
  },
}
```

---

### `resolver(map)`

After hook. Iterates the field map and calls each resolver with the current field value, the full record, and the hook context. The resolved value replaces the field in the output. Returning `undefined` removes the field entirely.

Supports single records (`T`), arrays (`T[]`), and paginated results (`Paginated<T>`).

```typescript
type FieldResolver<T, K extends keyof T> = (
  value: T[K] | undefined,
  data: T,
  context: HookContext,
) => Promise<T[K] | undefined> | T[K] | undefined;

type ResolverMap<T> = {
  [K in keyof T]?: FieldResolver<T, K>;
};

function resolver<T>(map: ResolverMap<T>): HookFunction;
```

```typescript
app.service("users").hooks({
  after: {
    all: [
      resolver<User>({
        // strip sensitive field
        password: () => undefined,
        // compute derived field
        fullName: (_, data) => `${data.firstName} ${data.lastName}`,
        // async lookup
        avatar: async (_, data) => fetchAvatar(data.id),
      }),
    ],
  },
});
```

---

## Schema registration on a service

Pass `schema` to `app.use()` to store it for tooling introspection (CLI, future OpenAPI generation):

```typescript
app.use("/users", new UserService(repo), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
  schema: UserSchema,
});

app.service("users").schema; // → TSchema | undefined
```

---

## Registering custom formats

`FormatRegistry` is re-exported from `@mantlejs/schema`. Call `FormatRegistry.Set` to add a format before any `validate()` hooks run:

```typescript
import { FormatRegistry } from "@mantlejs/schema";

FormatRegistry.Set("phone", (value) => /^\+[1-9]\d{6,14}$/.test(value));

const ContactSchema = Type.Object({
  phone: Type.String({ format: "phone" }),
});
```

---

## TypeBox re-exports

`@mantlejs/schema` re-exports the TypeBox builder and common type helpers so you import from one place:

```typescript
import { Type, Static, FormatRegistry } from "@mantlejs/schema";
import type { TSchema, TObject, TString, TNumber, TBoolean, TArray, TOptional } from "@mantlejs/schema";
```

---

## Types

```typescript
import type { ValidateOptions, ResolverMap, FieldResolver } from "@mantlejs/schema";
import type { TSchema, Static } from "@mantlejs/schema";
```

| Type | Description |
|---|---|
| `TSchema` | Base TypeBox schema type |
| `Static<T>` | Infers the TypeScript type from a schema |
| `ValidateOptions` | Options for `validate()` |
| `ResolverMap<T>` | Field-keyed map of resolver functions |
| `FieldResolver<T, K>` | Single field resolver function signature |

---

## Development

```bash
npx nx build schema   # compile
npx nx test schema    # run tests
npx nx lint schema    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build schema
```

First publish (scoped packages require `--access public`):

```bash
cd packages/schema
npm publish --access public
```

Subsequent releases — bump `version` in `packages/schema/package.json`, then:

```bash
cd packages/schema
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/schema
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/schema --registry http://localhost:4873
```
