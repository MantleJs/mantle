# @mantlejs/neo4j

Neo4j graph database adapter for [Mantle JS](https://github.com/mantlejs/mantle). Provides `Neo4jRepository<T>` — an abstract `GraphRepository<T>` base class that maps Mantle entities to Neo4j nodes, with Cypher query generation from `QueryParams.where`.

---

## Installation

```bash
npm install @mantlejs/neo4j neo4j-driver
```

---

## Concepts

### Graph model

Neo4j stores data as nodes and directed relationships. `Neo4jRepository<T>` maps one Mantle entity type to one Neo4j node label. Each node stores a UUID `id` property plus all other entity fields as node properties.

### QueryParams.where → Cypher WHERE

`findNodes(params?)` translates `QueryParams.where` to a parameterised Cypher `WHERE` clause. All standard Mantle operators are supported: equality, `$lt`/`$lte`/`$gt`/`$gte`, `$ne`, `$in`/`$nin`, `$like`/`$ilike`/`$notlike`, `$or`, `$and`.

### Relationships and traversal

`createRelationship` creates a directed `(a)-[:TYPE]->(b)` edge between two nodes of the same label. `traverse` walks relationships up to a configurable depth and returns the reached nodes.

### Transactions

`withTransaction(fn)` wraps a callback in a Neo4j write transaction. A transaction-scoped repository instance is passed to the callback so all operations inside share the same transaction.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { neo4j, Neo4jRepository } from "@mantlejs/neo4j";

interface Person extends Record<string, unknown> {
  id: string;
  name: string;
  age: number;
}

class PersonRepository extends Neo4jRepository<Person> {
  readonly label = "Person";
}

const app = mantle().configure(
  neo4j({
    uri: process.env.NEO4J_URI,
    auth: { username: "neo4j", password: process.env.NEO4J_PASSWORD! },
  }),
);

const repo = new PersonRepository(app);

// Create a node
const alice = await repo.createNode({ name: "Alice", age: 30 });
const bob   = await repo.createNode({ name: "Bob",   age: 25 });

// Create a relationship
await repo.createRelationship(alice.id, bob.id, "KNOWS", { since: "2024" });

// Traverse
const aliceFriends = await repo.traverse(alice.id, "KNOWS", 1);

// Filter nodes
const seniors = await repo.findNodes({ where: { age: { $gte: 30 } } });

// Raw Cypher
const result = await repo.cypher<Person>(
  "MATCH (n:Person) WHERE n.name STARTS WITH $prefix RETURN n",
  { prefix: "A" },
);
```

---

## API

### `neo4j(options)`

Returns a `MantlePlugin`. Call via `app.configure(neo4j(options))`.

```typescript
app.configure(
  neo4j({
    uri: "bolt://localhost:7687",              // optional — default bolt://localhost:7687
    auth: { username: "neo4j", password: "…" }, // required
    database: "neo4j",                         // optional — default "neo4j"
  }),
);
```

Side effects:

- Opens a Neo4j `Driver` and stores it at `app.get("neo4j")`
- Stores the resolved database name at `app.get("neo4j:database")`

#### `Neo4jOptions`

| Field      | Type                                | Default                        | Description                            |
| ---------- | ----------------------------------- | ------------------------------ | -------------------------------------- |
| `uri`      | `string`                            | `NEO4J_URI` env or `bolt://localhost:7687` | Bolt connection URI       |
| `auth`     | `{ username: string; password: string }` | —                         | Neo4j credentials (required)           |
| `database` | `string`                            | `NEO4J_DATABASE` env or `"neo4j"` | Target database name               |

---

### `Neo4jRepository<T>` (abstract class)

Implements `GraphRepository<T>` from `@mantlejs/mantle`.

```typescript
abstract class Neo4jRepository<T extends Record<string, unknown>> implements GraphRepository<T> {
  abstract readonly label: string;
}
```

Subclasses must declare `label`. All `GraphRepository<T>` methods are provided as concrete implementations.

#### `GraphRepository<T>` methods

| Method                                              | Cypher pattern                                            |
| --------------------------------------------------- | --------------------------------------------------------- |
| `createNode(data)`                                  | `CREATE (n:Label $props) RETURN n`                        |
| `findNodeById(id)`                                  | `MATCH (n:Label {id: $id}) RETURN n`                      |
| `findNodes(params?)`                                | `MATCH (n:Label) WHERE … RETURN n ORDER BY … SKIP … LIMIT …` |
| `createRelationship(fromId, toId, type, props?)`    | `MATCH (a), (b) WHERE … CREATE (a)-[r:TYPE $props]->(b)` |
| `traverse(startId, relation, depth?)`               | `MATCH (start)-[r:TYPE*1..depth]->(n) RETURN n`           |
| `deleteNode(id)`                                    | `MATCH (n:Label {id: $id}) DETACH DELETE n`               |
| `cypher<R>(query, params?)`                         | Raw Cypher passthrough                                    |

#### `withTransaction(fn)`

```typescript
await repo.withTransaction(async (txRepo) => {
  const alice = await txRepo.createNode({ name: "Alice", age: 30 });
  await txRepo.createNode({ name: "Bob",   age: 25 });
  await txRepo.createRelationship(alice.id, "…", "KNOWS");
});
```

#### Instance properties

| Property     | Type      | Default | Description                                              |
| ------------ | --------- | ------- | -------------------------------------------------------- |
| `label`      | `string`  | —       | **Required.** Neo4j node label for this repository       |
| `idField`    | `string`  | `"id"`  | Node property used as the entity identifier              |
| `timestamps` | `boolean` | `true`  | Auto-write `createdAt` / `updatedAt` ISO-8601 fields     |

#### `QueryParams.where` operators

| Mantle operator           | Cypher equivalent                           |
| ------------------------- | ------------------------------------------- |
| `{ field: value }`        | `n.field = $p`                              |
| `{ field: null }`         | `n.field IS NULL`                           |
| `{ field: [a, b] }`       | `n.field IN $p`                             |
| `$gt / $gte / $lt / $lte` | `>`, `>=`, `<`, `<=`                        |
| `$ne: value`              | `n.field <> $p`                             |
| `$ne: null`               | `n.field IS NOT NULL`                       |
| `$in`                     | `n.field IN $p`                             |
| `$nin`                    | `NOT n.field IN $p`                         |
| `$like: '%x%'`            | `CONTAINS` / `STARTS WITH` / `ENDS WITH`    |
| `$ilike`                  | `toLower(n.field) CONTAINS $p`              |
| `$notlike`                | `NOT (n.field CONTAINS $p)`                 |
| `$or`                     | `(a OR b OR …)`                             |
| `$and`                    | `(a AND b AND …)`                           |

---

## Types

```typescript
import type { Neo4jOptions, WhereClause, WhereResult } from "@mantlejs/neo4j";
```

| Type           | Description                                   |
| -------------- | --------------------------------------------- |
| `Neo4jOptions` | Options passed to `neo4j()` plugin             |
| `WhereClause`  | `QueryParams.where` clause type               |
| `WhereResult`  | Return value of `toNeo4jWhere` — `{ cypher, params }` |

---

## Development

```bash
npx nx build neo4j    # compile
npx nx test neo4j     # run tests
npx nx lint neo4j     # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build neo4j
```

First publish (scoped packages require `--access public`):

```bash
cd packages/neo4j
npm publish --access public
```

Subsequent releases — bump `version` in `packages/neo4j/package.json`, then:

```bash
cd packages/neo4j
npm publish
```
