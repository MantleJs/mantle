import { beforeEach, describe, expect, it } from "vitest";
import { BadRequest, mantle, NotFound, RepositoryService } from "@mantlejs/mantle";
import { MemoryRepository, MEMORY_OPERATORS } from "./memory-repository.js";

// B-2 acceptance suite: all six Service methods over the real MemoryRepository
// (the reference adapter with full operator support).

interface User extends Record<string, unknown> {
  id: string;
  name: string;
  age: number;
  active: boolean;
}

const userSchema = {
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    age: { type: "number" },
    active: { type: "boolean" },
  },
};

const SEED: User[] = [
  { id: "1", name: "Alice", age: 30, active: true },
  { id: "2", name: "Bob", age: 25, active: false },
  { id: "3", name: "Carol", age: 35, active: true },
  { id: "4", name: "Dave", age: 19, active: true },
];

describe("RepositoryService over MemoryRepository", () => {
  let repo: MemoryRepository<User>;
  let svc: RepositoryService<User>;

  beforeEach(() => {
    repo = new MemoryRepository<User>({ timestamps: false }).seed(SEED);
    svc = new RepositoryService<User>(repo, { schema: userSchema });
  });

  describe("find", () => {
    it("returns the full Paginated envelope with no query", async () => {
      const result = await svc.find();
      expect(result.total).toBe(4);
      expect(result.skip).toBe(0);
      expect(result.data).toHaveLength(4);
    });

    it("filters via coerced operator queries (strings in, numbers compared)", async () => {
      const result = await svc.find({ query: { age: { $gt: "21" } } });
      expect(result.data.map((u) => u.name).sort()).toEqual(["Alice", "Bob", "Carol"]);
      expect(result.total).toBe(3);
    });

    it("combines where, $sort, $limit, and $skip; total reflects the filter only", async () => {
      const result = await svc.find({
        query: { active: "true", $sort: { age: "desc" }, $limit: "2", $skip: "1" },
      });
      expect(result.data.map((u) => u.name)).toEqual(["Alice", "Dave"]);
      expect(result).toMatchObject({ total: 3, limit: 2, skip: 1 });
    });

    it("supports $or with coercion in each branch", async () => {
      const result = await svc.find({ query: { $or: [{ age: { $lt: "20" } }, { name: "Bob" }] } });
      expect(result.data.map((u) => u.name).sort()).toEqual(["Bob", "Dave"]);
    });

    it("projects with $select", async () => {
      const result = await svc.find({ query: { name: "Alice", $select: ["name"] } });
      expect(result.data[0]).toEqual({ name: "Alice" });
    });
  });

  describe("get", () => {
    it("returns the record by id", async () => {
      await expect(svc.get("2")).resolves.toMatchObject({ name: "Bob" });
    });

    it("throws NotFound for a missing id", async () => {
      await expect(svc.get("nope")).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("create", () => {
    it("saves a single record", async () => {
      const created = await svc.create({ name: "Eve", age: 40, active: true });
      expect(created.name).toBe("Eve");
      await expect(svc.get(created.id)).resolves.toMatchObject({ name: "Eve" });
    });

    it("saves arrays via saveAll", async () => {
      const created = await svc.create([
        { name: "Frank", age: 50, active: false },
        { name: "Grace", age: 60, active: true },
      ]);
      expect(created).toHaveLength(2);
      expect((await svc.find()).total).toBe(6);
    });
  });

  describe("update / patch / remove", () => {
    it("update replaces the record", async () => {
      const updated = await svc.update("1", { name: "Alicia", age: 31, active: false });
      expect(updated).toMatchObject({ name: "Alicia", age: 31 });
    });

    it("patch merges fields", async () => {
      const patched = await svc.patch("1", { age: 32 });
      expect(patched).toMatchObject({ name: "Alice", age: 32 });
    });

    it("remove deletes and returns the record", async () => {
      const removed = await svc.remove("4");
      expect(removed.name).toBe("Dave");
      await expect(svc.get("4")).rejects.toBeInstanceOf(NotFound);
    });

    it("propagates NotFound from the repository untouched", async () => {
      await expect(svc.update("nope", { name: "X" })).rejects.toBeInstanceOf(NotFound);
      await expect(svc.patch("nope", { name: "X" })).rejects.toBeInstanceOf(NotFound);
      await expect(svc.remove("nope")).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("field whitelist", () => {
    it("enforces options.fields against the live repository", async () => {
      const locked = new RepositoryService<User>(repo, { fields: ["name", "age"] });
      await expect(locked.find({ query: { active: "true" } })).rejects.toBeInstanceOf(BadRequest);
      await expect(locked.find({ query: { name: "Alice" } })).resolves.toMatchObject({ total: 1 });
    });
  });
});

// D-2 acceptance: a RepositoryService over MemoryRepository registered on a mantle app
// yields a full ServiceDescriptor — methods, events, schema, and repository capabilities.
describe("ServiceHandle.describe() over RepositoryService + MemoryRepository", () => {
  it("yields a descriptor with correct methods, events, schema, and operators", () => {
    const app = mantle();
    const memoryRepo = new MemoryRepository<User>({ timestamps: false }).seed(SEED);
    app.use("/users", new RepositoryService<User>(memoryRepo, { schema: userSchema }), {
      methods: ["find", "get", "create", "patch", "remove"],
      schema: userSchema,
    });

    const desc = app.service("users").describe();
    expect(desc.path).toBe("users");
    expect(desc.methods).toEqual(["find", "get", "create", "patch", "remove"]);
    expect(desc.events).toEqual(["created", "patched", "removed"]);
    expect(desc.schema).toBe(userSchema);
    expect(desc.capabilities?.adapter).toBe("@mantlejs/memory");
    expect(new Set(desc.capabilities?.operators)).toEqual(MEMORY_OPERATORS);
    expect(desc.authRequired).toBe(false);
  });
});
