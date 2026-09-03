import { describe, it, expect, vi, beforeEach } from "vitest";
import { Neo4jRepository } from "./neo4j-repository.js";
import { NEO4J_OPERATORS } from "./neo4j-where.js";
import { BadRequest, NotFound } from "@mantlejs/mantle";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Person extends Record<string, unknown> {
  id: string;
  name: string;
  age: number;
}

function makeRecord(props: Record<string, unknown>): import("neo4j-driver").Record {
  return {
    get: (key: string) => (key === "n" ? { properties: props } : props[key]),
    keys: ["n"],
  } as unknown as import("neo4j-driver").Record;
}

function makeSession(
  records: import("neo4j-driver").Record[] = [],
  runFn?: (q: string, p: unknown) => { records: import("neo4j-driver").Record[] },
) {
  const _run = runFn ?? (() => ({ records }));
  return {
    run: vi.fn().mockImplementation((q: string, p: unknown) => Promise.resolve(_run(q, p))),
    close: vi.fn().mockResolvedValue(undefined),
    executeWrite: vi.fn().mockImplementation(async (fn: (tx: { run: typeof _run }) => Promise<unknown>) => {
      return fn({ run: _run });
    }),
  };
}

function makeApp(session: ReturnType<typeof makeSession>) {
  const store: Record<string, unknown> = {
    neo4j: { session: () => session },
    "neo4j:database": "neo4j",
  };
  return {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => {
      store[key] = value;
    },
  };
}

class PersonRepository extends Neo4jRepository<Person> {
  readonly label = "Person";
}

class PersonRepositoryCustomTimestampFields extends Neo4jRepository<Person> {
  readonly label = "Person";
  override readonly createdAtField = "created_at";
  override readonly updatedAtField = "updated_at";
}

interface Account extends Record<string, unknown> {
  id: string;
  userName: string;
}

class AccountRepositoryFieldMap extends Neo4jRepository<Account> {
  readonly label = "Account";
  override readonly fieldMap = { userName: "user_name" };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Neo4jRepository", () => {
  let session: ReturnType<typeof makeSession>;
  let repo: PersonRepository;

  beforeEach(() => {
    session = makeSession();
    const app = makeApp(session);
    repo = new PersonRepository(app as never);
    // Override openSession to return our mock session
    vi.spyOn(repo as unknown as { openSession(): unknown }, "openSession").mockReturnValue(session);
  });

  describe("findNodeById", () => {
    it("returns null when no node found", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      const result = await repo.findNodeById("abc");
      expect(result).toBeNull();
    });

    it("returns the entity when found", async () => {
      const props = { id: "1", name: "Alice", age: 30 };
      session.run.mockResolvedValueOnce({ records: [makeRecord(props)] });
      const result = await repo.findNodeById("1");
      expect(result).toEqual(props);
    });

    it("queries by the idField", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await repo.findNodeById("1");
      expect(session.run).toHaveBeenCalledWith(expect.stringContaining("MATCH (n:Person {id: $id})"), { id: "1" });
    });
  });

  describe("createNode", () => {
    it("creates a node and returns the entity", async () => {
      const props = {
        id: "abc-123",
        name: "Bob",
        age: 25,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      };
      session.run.mockResolvedValueOnce({ records: [makeRecord(props)] });
      const result = await repo.createNode({ name: "Bob", age: 25 });
      expect(result).toMatchObject({ name: "Bob", age: 25 });
    });

    it("uses createdAtField/updatedAtField when overridden", async () => {
      const customRepo = new PersonRepositoryCustomTimestampFields(makeApp(session) as never);
      vi.spyOn(customRepo as unknown as { openSession(): unknown }, "openSession").mockReturnValue(session);
      session.run.mockResolvedValueOnce({ records: [makeRecord({ id: "abc-123", name: "Bob", age: 25 })] });
      await customRepo.createNode({ name: "Bob", age: 25 });
      expect(session.run).toHaveBeenCalledWith(
        expect.stringContaining("CREATE (n:Person $props) RETURN n"),
        expect.objectContaining({
          props: expect.objectContaining({ created_at: expect.any(String), updated_at: expect.any(String) }),
        }),
      );
      const [, { props }] = session.run.mock.calls[0] as [string, { props: Record<string, unknown> }];
      expect(props).not.toHaveProperty("createdAt");
      expect(props).not.toHaveProperty("updatedAt");
    });

    it("uses a provided id", async () => {
      session.run.mockResolvedValueOnce({ records: [makeRecord({ id: "my-id", name: "Carol", age: 22 })] });
      await repo.createNode({ id: "my-id", name: "Carol", age: 22 });
      expect(session.run).toHaveBeenCalledWith(
        expect.stringContaining("CREATE (n:Person $props) RETURN n"),
        expect.objectContaining({ props: expect.objectContaining({ id: "my-id" }) }),
      );
    });
  });

  describe("findNodes", () => {
    it("returns all nodes when no params", async () => {
      const propsA = { id: "1", name: "Alice", age: 30 };
      const propsB = { id: "2", name: "Bob", age: 25 };
      session.run.mockResolvedValueOnce({ records: [makeRecord(propsA), makeRecord(propsB)] });
      const result = await repo.findNodes();
      expect(result).toHaveLength(2);
    });

    it("adds WHERE clause from params.where", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await repo.findNodes({ where: { name: "Alice" } });
      expect(session.run).toHaveBeenCalledWith(expect.stringContaining("WHERE"), expect.any(Object));
    });

    it("adds SKIP and LIMIT from params", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await repo.findNodes({ skip: 5, limit: 10 });
      const query = session.run.mock.calls[0][0] as string;
      expect(query).toContain("SKIP 5");
      expect(query).toContain("LIMIT 10");
    });

    it("adds ORDER BY from params.sort", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await repo.findNodes({ sort: { name: "asc" } });
      const query = session.run.mock.calls[0][0] as string;
      expect(query).toContain("ORDER BY n.name ASC");
    });

    it("rejects Cypher injection via sort field names before reaching session.run", async () => {
      await expect(repo.findNodes({ sort: { "id} RETURN n //": "asc" } })).rejects.toBeInstanceOf(BadRequest);
      expect(session.run).not.toHaveBeenCalled();
    });

    it("rejects an invalid sort direction before reaching session.run", async () => {
      await expect(repo.findNodes({ sort: { name: "asc} RETURN n //" as "asc" } })).rejects.toBeInstanceOf(BadRequest);
      expect(session.run).not.toHaveBeenCalled();
    });

    it("rejects Cypher injection via where field names before reaching session.run", async () => {
      await expect(repo.findNodes({ where: { "name = 'x' RETURN n //": "Alice" } })).rejects.toBeInstanceOf(BadRequest);
      expect(session.run).not.toHaveBeenCalled();
    });
  });

  describe("deleteNode", () => {
    it("throws NotFound when node does not exist", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await expect(repo.deleteNode("missing")).rejects.toBeInstanceOf(NotFound);
    });

    it("deletes node and returns the entity", async () => {
      const props = { id: "1", name: "Alice", age: 30 };
      session.run
        .mockResolvedValueOnce({ records: [makeRecord(props)] }) // findNodeById
        .mockResolvedValueOnce({ records: [] }); // DETACH DELETE
      const result = await repo.deleteNode("1");
      expect(result).toEqual(props);
      expect(session.run).toHaveBeenCalledWith(expect.stringContaining("DETACH DELETE"), expect.any(Object));
    });
  });

  describe("createRelationship", () => {
    it("runs the relationship CREATE query", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await repo.createRelationship("1", "2", "KNOWS", { since: "2024" });
      expect(session.run).toHaveBeenCalledWith(expect.stringContaining("CREATE (a)-[r:KNOWS $props]->(b)"), {
        from: "1",
        to: "2",
        props: { since: "2024" },
      });
    });
  });

  describe("traverse", () => {
    it("runs the path traversal query with default depth 1", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await repo.traverse("1", "KNOWS");
      expect(session.run).toHaveBeenCalledWith(expect.stringContaining("[r:KNOWS*1..1]"), { id: "1" });
    });

    it("uses the provided depth", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await repo.traverse("1", "KNOWS", 3);
      expect(session.run).toHaveBeenCalledWith(expect.stringContaining("[r:KNOWS*1..3]"), { id: "1" });
    });

    it("returns nodes from the traversal result", async () => {
      const friend = { id: "2", name: "Bob", age: 25 };
      session.run.mockResolvedValueOnce({ records: [makeRecord(friend)] });
      const result = await repo.traverse("1", "KNOWS");
      expect(result).toEqual([friend]);
    });
  });

  describe("raw", () => {
    it("runs a raw query and returns results", async () => {
      const node = { properties: { id: "1", name: "Alice", age: 30 } };
      session.run.mockResolvedValueOnce({
        records: [{ get: (k: string) => (k === "n" ? node : undefined), keys: ["n"] }],
      });
      const result = await repo.raw<Person>("MATCH (n:Person) RETURN n");
      expect(result[0]).toEqual(node.properties);
    });
  });

  describe("fieldMap", () => {
    let mappedRepo: AccountRepositoryFieldMap;

    beforeEach(() => {
      mappedRepo = new AccountRepositoryFieldMap(makeApp(session) as never);
      vi.spyOn(mappedRepo as unknown as { openSession(): unknown }, "openSession").mockReturnValue(session);
    });

    it("translates data payload keys to node property names on createNode", async () => {
      session.run.mockResolvedValueOnce({ records: [makeRecord({ id: "1", user_name: "alice" })] });
      await mappedRepo.createNode({ userName: "alice" });
      const [, { props }] = session.run.mock.calls[0] as [string, { props: Record<string, unknown> }];
      expect(props).toHaveProperty("user_name", "alice");
      expect(props).not.toHaveProperty("userName");
    });

    it("translates node properties back to entity field names", async () => {
      session.run.mockResolvedValueOnce({ records: [makeRecord({ id: "1", user_name: "alice" })] });
      const result = await mappedRepo.findNodeById("1");
      expect(result).toEqual({ id: "1", userName: "alice" });
    });

    it("translates where clause field names in findNodes", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await mappedRepo.findNodes({ where: { userName: "alice" } });
      const query = session.run.mock.calls[0][0] as string;
      expect(query).toContain("n.user_name");
      expect(query).not.toContain("n.userName");
    });

    it("translates sort field names in findNodes", async () => {
      session.run.mockResolvedValueOnce({ records: [] });
      await mappedRepo.findNodes({ sort: { userName: "asc" } });
      const query = session.run.mock.calls[0][0] as string;
      expect(query).toContain("ORDER BY n.user_name ASC");
    });
  });

  describe("describe()", () => {
    it("reports the exact operator set assertOperators accepts", () => {
      const caps = repo.describe();
      expect(caps.adapter).toBe("@mantlejs/neo4j");
      expect(new Set(caps.operators)).toEqual(NEO4J_OPERATORS);
      expect(caps.pagination).toBe("offset");
      expect(caps.fullTextSearch).toBe(false);
    });
  });
});
