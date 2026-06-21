# @mantlejs/schema

TypeBox schema definition, Ajv validation, and data resolution for [Mantle JS](https://github.com/mantlejs/mantle). Re-exports the TypeBox builder so a single schema definition produces both a TypeScript type and a validated runtime contract. Uses Ajv with `ajv-formats` for RFC-compliant string format validation out of the box.

---

## Installation

```bash
npm install @mantlejs/schema
```

`@sinclair/typebox`, `ajv`, and `ajv-formats` ship as direct dependencies — no separate install needed.

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

### RFC-compliant format validation

`@mantlejs/schema` uses **Ajv** with **`ajv-formats`** for validation. Common JSON Schema string formats are validated against the relevant RFCs out of the box:

| Format | RFC |
|---|---|
| `email` | RFC 5321/5322 |
| `date-time` | RFC 3339 |
| `date` | ISO 8601 |
| `uuid` | RFC 4122 |
| `uri` | RFC 3986 |
| `ipv4` / `ipv6` | RFC 791 / RFC 4291 |

No setup required — formats are validated automatically when you add them to a TypeBox schema.

### Validation vs resolution

- **`validate()`** — runs in a `before` hook. Validates incoming data against the schema using Ajv. Throws `Unprocessable` with field-level errors on failure.
- **`resolver()`** — runs in an `after` hook. Transforms the result field-by-field: strip sensitive data, compute derived fields, or join related records.

---

## Quick start

```typescript
import { Type, Static, validate, resolver } from "@mantlejs/schema";

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
        password: () => undefined, // returning undefined removes the field
      }),
    ],
  },
});
```

---

## API

### `validate(schema, options?)`

Before hook. Validates `context.data` (default), `context.result`, or `context.params.query` against a TypeBox schema using Ajv. Throws `Unprocessable` with field-level error details on failure.

Compiled validators are cached per schema object reference — Ajv compiles once on first use, not on every request.

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

`coerce` uses TypeBox's `Value.Convert` and `stripAdditional` uses `Value.Clean` as pre-processing steps before Ajv validates. The transformed value is written back to the context target.

```typescript
app.service("users").hooks({
  before: {
    create: [validate(UserSchema)],
    // coerce query string params ("limit=10") to numbers before validating
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

### `validate(validator, options?)` — BYOV

Pass a function as the first argument to bypass Ajv entirely and use any validation library. The function receives the raw data and returns either an array of `{ field, message }` errors (triggers `Unprocessable`) or `null`/`undefined`/empty array (passes).

```typescript
type ValidatorFn = (data: unknown) => Array<{ field: string; message: string }> | null | undefined;

function validate(validator: ValidatorFn, options?: Pick<ValidateOptions, "target">): HookFunction;
```

`coerce` and `stripAdditional` do not apply — the custom validator handles any transforms.

```typescript
import { z } from "zod";
import type { ValidatorFn } from "@mantlejs/schema";

const UserZod = z.object({ email: z.string().email(), name: z.string().min(1) });

const zodValidator: ValidatorFn = (data) => {
  const result = UserZod.safeParse(data);
  if (result.success) return null;
  return result.error.issues.map((i) => ({
    field: "/" + i.path.join("/"),
    message: i.message,
  }));
};

app.service("users").hooks({
  before: { create: [validate(zodValidator)] },
});
```

> Ajv is a hard dependency of `@mantlejs/schema` and is always loaded. BYOV replaces the validation logic, not the package dependency. If removing Ajv entirely is a requirement, skip `@mantlejs/schema` and throw `Unprocessable` from a plain hook function.

---

### `resolver(map, options?)`

After hook. Iterates the field map and calls each resolver with the current field value, the full record, the hook context, and an optional shared context. Returning `undefined` removes the field entirely. Supports single records (`T`), arrays (`T[]`), and paginated results (`Paginated<T>`).

```typescript
type FieldResolver<T, K extends keyof T, C = undefined> = (
  value: T[K] | undefined,
  data: T,
  context: HookContext,
  shared: C,
) => Promise<T[K] | undefined> | T[K] | undefined;

type ResolverMap<T, C = undefined> = {
  [K in keyof T]?: FieldResolver<T, K, C>;
};

interface ResolverOptions<T, C> {
  createContext?: (record: T, ctx: HookContext) => Promise<C> | C;
}

function resolver<T, C = undefined>(map: ResolverMap<T, C>, options?: ResolverOptions<T, C>): HookFunction;
```

```typescript
app.service("users").hooks({
  after: {
    all: [
      resolver<User>({
        password: () => undefined,                      // strip sensitive field
        fullName: (_, data) => `${data.firstName} ${data.lastName}`, // compute derived field
        avatar:   async (_, data) => fetchAvatar(data.id),           // async lookup
      }),
    ],
  },
});
```

#### Shared context

`createContext` is called once per record before field resolvers run. Its return value is passed to every field resolver as the fourth argument. Use this to perform a single expensive async lookup shared across multiple fields:

```typescript
resolver<User, { isAdmin: boolean }>(
  {
    role:  (_, data, ctx, shared) => shared.isAdmin ? data.role : "viewer",
    badge: (_, data, ctx, shared) => shared.isAdmin ? "admin" : null,
  },
  {
    createContext: async (record) => ({ isAdmin: await checkAdmin(record.id) }),
  },
)
```

For array and paginated results, `createContext` is called once per element. Existing field resolvers that ignore the fourth argument continue to work — TypeScript allows functions with fewer parameters.

---

## Schema registration on a service

Pass `schema` to `app.use()` to store it for tooling introspection (CLI code generation, future OpenAPI output):

```typescript
app.use("/users", new UserService(repo), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
  schema: UserSchema,
});

app.service("users").schema; // → TSchema | undefined
```

---

## TypeBox re-exports

`@mantlejs/schema` re-exports the TypeBox builder and common type helpers:

```typescript
import { Type, Static, FormatRegistry } from "@mantlejs/schema";
import type { TSchema, TObject, TString, TNumber, TBoolean, TArray, TOptional } from "@mantlejs/schema";
```

---

## Types

```typescript
import type { ValidateOptions, ValidatorFn, ResolverMap, FieldResolver, ResolverOptions } from "@mantlejs/schema";
import type { TSchema, Static } from "@mantlejs/schema";
```

| Type | Description |
|---|---|
| `TSchema` | Base TypeBox schema type |
| `Static<T>` | Infers the TypeScript type from a schema |
| `ValidateOptions` | Options for the TypeBox + Ajv overload of `validate()` |
| `ValidatorFn` | Custom validator function signature for the BYOV overload |
| `ResolverMap<T, C>` | Field-keyed map of resolver functions |
| `FieldResolver<T, K, C>` | Single field resolver function signature |
| `ResolverOptions<T, C>` | Options for `resolver()`, including `createContext` |

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
