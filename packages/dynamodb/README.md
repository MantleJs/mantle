# @mantlejs/dynamodb

Amazon DynamoDB adapter for [Mantle JS](https://github.com/mantlejs/mantle). Provides a `dynamodb()` Mantle plugin and an abstract `DynamoDbRepository<T>` base class that implements the `Repository<T>` interface using the AWS SDK v3.

---

## Installation

```bash
npm install @mantlejs/dynamodb @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
```

---

## Concepts

### Plugin

`dynamodb()` is a Mantle plugin. It creates an `@aws-sdk/client-dynamodb` `DynamoDBClient` instance and stores it on the application at `app.get("dynamodb")`. When the application tears down, the client is destroyed automatically.

### Repository

`DynamoDbRepository<T>` implements the Mantle `Repository<T>` contract against DynamoDB. Extend it with a concrete class, declare `tableName`, and the full set of methods (`findAll`, `findById`, `save`, `saveAll`, `updateById`, `patchById`, `deleteById`, `count`) work out of the box.

The repository uses:

- **GetItem** for `findById`
- **PutItem** for `save`
- **BatchWriteItem** for `saveAll` (auto-chunked at 25 items per DynamoDB limit)
- **UpdateItem** with a condition expression for `updateById` and `patchById`
- **DeleteItem** with a condition expression for `deleteById`
- **Scan** for `findAll` (falls back to **Query** when a sort key is configured and the partition key is in the where clause)
- **Scan with SELECT COUNT** for `count`

### Query translation

`dynamodbify()` converts a Mantle `QueryParams.where` clause into a DynamoDB `FilterExpression`. Supported operators:

| Operator                           | DynamoDB expression        |
| ---------------------------------- | -------------------------- |
| `{ field: value }`                 | `#n = :v`                  |
| `{ field: null }`                  | `attribute_not_exists(#n)` |
| `{ field: { $gt } }`               | `#n > :v`                  |
| `{ field: { $gte } }`              | `#n >= :v`                 |
| `{ field: { $lt } }`               | `#n < :v`                  |
| `{ field: { $lte } }`              | `#n <= :v`                 |
| `{ field: { $ne: value } }`        | `#n <> :v`                 |
| `{ field: { $ne: null } }`         | `attribute_exists(#n)`     |
| `{ field: { $in: [...] } }`        | `#n IN (...)`              |
| `{ field: [a, b] }`                | `#n IN (...)` (shorthand)  |
| `{ field: { $nin: [...] } }`       | `NOT (#n IN (...))`        |
| `{ field: { $begins: "prefix" } }` | `begins_with(#n, :v)`      |
| `{ field: { $like: "str" } }`      | `contains(#n, :v)`         |
| `{ field: { $contains: "str" } }`  | `contains(#n, :v)`         |
| `{ $or: [...] }`                   | `(expr OR expr)`           |
| `{ $and: [...] }`                  | `(expr AND expr)`          |

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { dynamodb, DynamoDbRepository } from "@mantlejs/dynamodb";

// ─── Domain entity ─────────────────────────────────────────────────────────

interface Post extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published";
}

// ─── Infrastructure ────────────────────────────────────────────────────────

class PostRepository extends DynamoDbRepository<Post> {
  readonly tableName = "posts";
  // partitionKey defaults to "id"

  /** Custom query: find all published posts */
  async findPublished(): Promise<Post[]> {
    return this.findAll({ where: { status: "published" } });
  }
}

// ─── Application ───────────────────────────────────────────────────────────

const app = mantle()
  .configure(express())
  .configure(dynamodb({ region: "us-east-1" }));

const posts = new PostRepository(app);

app.use("/posts", new PostService(posts), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
});

app.listen(3030);
```

### Local development (DynamoDB Local)

```typescript
const app = mantle().configure(
  dynamodb({
    clientConfig: {
      region: "us-east-1",
      endpoint: "http://localhost:8000",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    },
  }),
);
```

### Composite key (partition + sort key)

```typescript
interface OrderItem extends Record<string, unknown> {
  orderId: string;
  itemId: string;
  quantity: number;
}

class OrderItemRepository extends DynamoDbRepository<OrderItem> {
  readonly tableName = "order-items";
  override readonly partitionKey = "orderId";
  override readonly sortKey = "itemId";
}

// findById with composite key
const item = await repo.findById({ pk: "ORDER#123", sk: "ITEM#456" });

// findAll — Query is used automatically when partitionKey is in the where clause
const items = await repo.findAll({ where: { orderId: "ORDER#123" } });
```

---

## API

### `dynamodb(config?)`

Returns a `MantlePlugin`. Call via `app.configure(dynamodb(config))`.

```typescript
app.configure(dynamodb({
  region: "us-east-1",           // optional — AWS region
  clientConfig: { ... },         // optional — full DynamoDBClientConfig (overrides region)
}));
```

Side effects:

- Stores the `DynamoDBClient` at `app.get("dynamodb")`
- Wraps `app.teardown()` to call `client.destroy()` on shutdown

#### `DynamoDbConfig`

| Field          | Type                   | Default | Description                                                  |
| -------------- | ---------------------- | ------- | ------------------------------------------------------------ |
| `region`       | `string`               | —       | AWS region. Falls back to `AWS_REGION` env var when omitted. |
| `clientConfig` | `DynamoDBClientConfig` | —       | Full AWS SDK client config. Takes precedence over `region`.  |

---

### `DynamoDbRepository<T, D>`

Abstract base class. Extend it, declare `tableName`, and override optional properties.

```typescript
class UserRepository extends DynamoDbRepository<User> {
  readonly tableName = "users";

  // Optional overrides:
  override readonly partitionKey = "userId";
  override readonly sortKey = "email";
  override readonly timestamps = false;
}
```

#### Properties

| Property       | Type                                     | Default     | Description                                                              |
| -------------- | ---------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `tableName`    | `string`                                 | —           | DynamoDB table name **(required)**                                       |
| `partitionKey` | `string`                                 | `"id"`      | Partition key attribute name                                             |
| `sortKey`      | `string \| undefined`                    | `undefined` | Sort key attribute name (composite key tables)                           |
| `timestamps`   | `boolean`                                | `true`      | Auto-write `createdAt` / `updatedAt` ISO-8601 strings                    |
| `lastKey`      | `Record<string, AttributeValue> \| undefined` | `undefined` | **Deprecated** — use `findPage()`. `LastEvaluatedKey` from the most recent paginated `findAll()` call |

#### Methods (from `Repository<T>`)

| Method                 | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `findAll(params?)`     | Scan (or Query when PK is in where). Supports `skip`/`limit` offsets. |
| `findPage(params?)`    | One page via native cursor pagination — see below                    |
| `findById(id)`         | GetItem by partition key (or composite key)                          |
| `save(data)`           | PutItem — auto-generates UUID when no `partitionKey` is set          |
| `saveAll(data[])`      | BatchWriteItem in chunks of 25 — auto-generates UUIDs as needed      |
| `updateById(id, data)` | UpdateItem (full replacement, throws NotFound if missing)            |
| `patchById(id, data)`  | UpdateItem (partial, strips `undefined`, throws NotFound if missing) |
| `deleteById(id)`       | DeleteItem (throws NotFound if missing)                              |
| `count(params?)`       | Scan SELECT COUNT (paginates automatically)                          |
| `withTransaction(fn)`  | Execute writes atomically via TransactWriteItems (100-item limit)    |

#### Cursor pagination

DynamoDB is natively cursor-paginated. Use `findPage()` — each page carries an opaque `cursor`
(the `LastEvaluatedKey`, base64-JSON encoded); pass it back to fetch the next page:

```typescript
const repo = new PostRepository(app);

// First page
const page1 = await repo.findPage({ limit: 20 });

// Next page — pass the cursor from the previous page
if (page1.cursor) {
  const page2 = await repo.findPage({ limit: 20, cursor: page1.cursor });
}
```

`findPage()` is stateless — the cursor lives entirely in the returned page, so concurrent calls on one
repository instance never interfere. It uses Query when a `sortKey` is defined and the where clause pins
the partition key, otherwise Scan. `skip` and `sort` are rejected with `BadRequest` (offsets and
cross-page ordering don't compose with cursors — use `findAll()` for those). Note that with a filtering
`where`, DynamoDB applies `limit` *before* filtering, so a page may hold fewer than `limit` items while
`cursor` is still set.

> **Deprecated:** the previous mechanism — reading `repo.lastKey` after `findAll()` and passing it back
> as `_startKey` — still works but shares mutable state on the repository instance. It will be removed
> in the next minor release.

`skip` on `findAll()` performs in-memory offset (scans all pages) — use `findPage()` for large tables.

#### Transactions

```typescript
await repo.withTransaction(async (tx) => {
  await tx.save({ id: "order-1", status: "pending", total: 99.99 });
  await tx.save({ id: "item-1", orderId: "order-1", qty: 2 });
});
```

In transaction mode, mutation methods return the input data immediately (DynamoDB `TransactWriteItems` does not support `ReturnValues`). All writes commit atomically when the callback resolves.

---

### `dynamodbify(where)`

Converts a Mantle `where` clause to a DynamoDB `FilterExpression`. Useful when writing raw SDK commands inside a custom repository method.

```typescript
import { dynamodbify } from "@mantlejs/dynamodb";

const { expression, names, values } = dynamodbify({
  status: "active",
  age: { $gt: 18 },
});
// expression: "#n0 = :v0 AND #n1 > :v1"
```

### `buildKeyCondition(partitionKey, sortKey, where)`

Splits a where clause into a `KeyConditionExpression` and an optional `FilterExpression` for use in `QueryCommand`.

---

## Types

```typescript
import type { DynamoDbConfig } from "@mantlejs/dynamodb";
import type { FilterExpression, WhereClause } from "@mantlejs/dynamodb";
```

| Type               | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| `DynamoDbConfig`   | Options passed to `dynamodb()`                                   |
| `WhereClause`      | Input type for `dynamodbify()` and `buildKeyCondition()`         |
| `FilterExpression` | Return type of `dynamodbify()` — `{ expression, names, values }` |

---

## Development

```bash
npx nx build dynamodb     # compile
npx nx test dynamodb      # run tests
npx nx lint dynamodb      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build dynamodb
```

First publish (scoped packages require `--access public`):

```bash
cd packages/dynamodb
npm publish --access public
```

Subsequent releases — bump `version` in `packages/dynamodb/package.json`, then:

```bash
cd packages/dynamodb
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/dynamodb
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/dynamodb --registry http://localhost:4873
```
