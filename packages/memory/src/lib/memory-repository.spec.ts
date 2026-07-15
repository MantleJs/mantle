import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepository, MEMORY_OPERATORS } from "./memory-repository.js";
import { NotFound } from "@mantlejs/mantle";

interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  createdAt?: string;
  updatedAt?: string;
}

describe("MemoryRepository", () => {
  let repo: MemoryRepository<User>;

  beforeEach(() => {
    repo = new MemoryRepository<User>();
  });

  describe("seed / clear / store", () => {
    it("seeds records into the store", () => {
      repo.seed([{ id: "1", name: "Alice", email: "alice@example.com", age: 30 }]);
      expect(repo.store.size).toBe(1);
    });

    it("clear empties the store", () => {
      repo.seed([{ id: "1", name: "Alice", email: "alice@example.com", age: 30 }]);
      repo.clear();
      expect(repo.store.size).toBe(0);
    });

    it("store is readonly", () => {
      expect(repo.store).toBeInstanceOf(Map);
    });

    it("seed returns this for chaining", () => {
      expect(repo.seed([])).toBe(repo);
    });

    it("clear returns this for chaining", () => {
      expect(repo.clear()).toBe(repo);
    });
  });

  describe("save", () => {
    it("saves a record and returns it with auto-generated id", async () => {
      const user = await repo.save({ name: "Alice", email: "alice@example.com", age: 30 });
      expect(user.id).toBeDefined();
      expect(user.name).toBe("Alice");
    });

    it("preserves a provided id", async () => {
      const user = await repo.save({ id: "fixed-id", name: "Bob", email: "bob@example.com", age: 25 });
      expect(user.id).toBe("fixed-id");
    });

    it("adds createdAt and updatedAt when timestamps enabled", async () => {
      const user = await repo.save({ name: "Alice", email: "alice@example.com", age: 30 });
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
    });

    it("omits timestamps when disabled", async () => {
      const r = new MemoryRepository<User>({ timestamps: false });
      const user = await r.save({ name: "Alice", email: "alice@example.com", age: 30 });
      expect(user.createdAt).toBeUndefined();
      expect(user.updatedAt).toBeUndefined();
    });
  });

  describe("saveAll", () => {
    it("saves multiple records", async () => {
      const users = await repo.saveAll([
        { name: "Alice", email: "alice@example.com", age: 30 },
        { name: "Bob", email: "bob@example.com", age: 25 },
      ]);
      expect(users).toHaveLength(2);
      expect(repo.store.size).toBe(2);
    });
  });

  describe("findById", () => {
    it("returns the record by id", async () => {
      repo.seed([{ id: "1", name: "Alice", email: "alice@example.com", age: 30 }]);
      const user = await repo.findById("1");
      expect(user?.name).toBe("Alice");
    });

    it("returns null when not found", async () => {
      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findAll", () => {
    beforeEach(() => {
      repo.seed([
        { id: "1", name: "Alice", email: "alice@example.com", age: 30 },
        { id: "2", name: "Bob", email: "bob@example.com", age: 25 },
        { id: "3", name: "Charlie", email: "charlie@example.com", age: 35 },
      ]);
    });

    it("returns all records when no params", async () => {
      expect(await repo.findAll()).toHaveLength(3);
    });

    it("filters by equality", async () => {
      const results = await repo.findAll({ where: { name: "Alice" } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Alice");
    });

    it("filters null fields", async () => {
      repo.clear();
      repo.seed([
        { id: "1", name: "Alice", email: "alice@example.com", age: 30 },
        { id: "2", name: null as unknown as string, email: "bob@example.com", age: 25 },
      ]);
      const results = await repo.findAll({ where: { name: null } });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("2");
    });

    it("filters $in", async () => {
      const results = await repo.findAll({ where: { name: { $in: ["Alice", "Bob"] } } });
      expect(results).toHaveLength(2);
    });

    it("filters $nin", async () => {
      const results = await repo.findAll({ where: { name: { $nin: ["Alice"] } } });
      expect(results).toHaveLength(2);
    });

    it("filters $gt", async () => {
      const results = await repo.findAll({ where: { age: { $gt: 25 } } });
      expect(results).toHaveLength(2);
    });

    it("filters $gte", async () => {
      const results = await repo.findAll({ where: { age: { $gte: 30 } } });
      expect(results).toHaveLength(2);
    });

    it("filters $lt", async () => {
      const results = await repo.findAll({ where: { age: { $lt: 30 } } });
      expect(results).toHaveLength(1);
    });

    it("filters $lte", async () => {
      const results = await repo.findAll({ where: { age: { $lte: 30 } } });
      expect(results).toHaveLength(2);
    });

    it("filters $ne value", async () => {
      const results = await repo.findAll({ where: { name: { $ne: "Alice" } } });
      expect(results).toHaveLength(2);
    });

    it("filters $ne null (not null)", async () => {
      repo.clear();
      repo.seed([
        { id: "1", name: "Alice", email: "alice@example.com", age: 30 },
        { id: "2", name: null as unknown as string, email: "bob@example.com", age: 25 },
      ]);
      const results = await repo.findAll({ where: { name: { $ne: null } } });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("filters $like", async () => {
      const results = await repo.findAll({ where: { name: { $like: "Ali%" } } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Alice");
    });

    it("filters $notlike", async () => {
      const results = await repo.findAll({ where: { name: { $notlike: "Ali%" } } });
      expect(results).toHaveLength(2);
    });

    it("filters $ilike case-insensitively", async () => {
      const results = await repo.findAll({ where: { name: { $ilike: "alice" } } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Alice");
    });

    it("filters $or", async () => {
      const results = await repo.findAll({ where: { $or: [{ name: "Alice" }, { name: "Bob" }] } });
      expect(results).toHaveLength(2);
    });

    it("filters $and", async () => {
      const results = await repo.findAll({ where: { $and: [{ name: "Alice" }, { age: { $gte: 30 } }] } });
      expect(results).toHaveLength(1);
    });

    it("applies limit", async () => {
      const results = await repo.findAll({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("applies skip", async () => {
      const results = await repo.findAll({ skip: 2 });
      expect(results).toHaveLength(1);
    });

    it("applies sort asc", async () => {
      const results = await repo.findAll({ sort: { age: "asc" } });
      expect(results[0].name).toBe("Bob");
      expect(results[2].name).toBe("Charlie");
    });

    it("applies sort desc", async () => {
      const results = await repo.findAll({ sort: { age: "desc" } });
      expect(results[0].name).toBe("Charlie");
    });

    it("applies select to limit returned fields", async () => {
      const results = await repo.findAll({ select: ["id", "name"] });
      expect(results[0]).toHaveProperty("name");
      expect(results[0]).not.toHaveProperty("email");
    });
  });

  describe("updateById", () => {
    it("replaces the record entirely (except id)", async () => {
      repo.seed([{ id: "1", name: "Alice", email: "alice@example.com", age: 30 }]);
      const updated = await repo.updateById("1", { name: "Alicia", email: "alicia@example.com", age: 31 });
      expect(updated.name).toBe("Alicia");
    });

    it("throws NotFound when record does not exist", async () => {
      await expect(repo.updateById("missing", { name: "X", email: "x@x.com", age: 1 })).rejects.toBeInstanceOf(NotFound);
    });

    it("preserves createdAt and updates updatedAt", async () => {
      await repo.save({ id: "1", name: "Alice", email: "alice@example.com", age: 30 });
      const original = await repo.findById("1");
      await new Promise((r) => setTimeout(r, 5));
      const updated = await repo.updateById("1", { name: "Alicia", email: "alicia@example.com", age: 31 });
      expect(updated.createdAt).toBe(original?.createdAt);
      expect(updated.updatedAt).not.toBe(original?.updatedAt);
    });
  });

  describe("patchById", () => {
    it("merges partial data into the existing record", async () => {
      repo.seed([{ id: "1", name: "Alice", email: "alice@example.com", age: 30 }]);
      const patched = await repo.patchById("1", { name: "Alicia" });
      expect(patched.name).toBe("Alicia");
      expect(patched.email).toBe("alice@example.com");
    });

    it("throws NotFound when record does not exist", async () => {
      await expect(repo.patchById("missing", { name: "X" })).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("deleteById", () => {
    it("removes and returns the record", async () => {
      repo.seed([{ id: "1", name: "Alice", email: "alice@example.com", age: 30 }]);
      const deleted = await repo.deleteById("1");
      expect(deleted.name).toBe("Alice");
      expect(repo.store.size).toBe(0);
    });

    it("throws NotFound when record does not exist", async () => {
      await expect(repo.deleteById("missing")).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("count", () => {
    beforeEach(() => {
      repo.seed([
        { id: "1", name: "Alice", email: "alice@example.com", age: 30 },
        { id: "2", name: "Bob", email: "bob@example.com", age: 25 },
        { id: "3", name: "Charlie", email: "charlie@example.com", age: 35 },
      ]);
    });

    it("counts all records without params", async () => {
      expect(await repo.count()).toBe(3);
    });

    it("counts with a where filter", async () => {
      expect(await repo.count({ where: { age: { $gt: 25 } } })).toBe(2);
    });
  });

  describe("custom idField", () => {
    it("uses the specified id field", async () => {
      const r = new MemoryRepository<{ _id: string; name: string }>({ idField: "_id" });
      const record = await r.save({ name: "Alice" });
      expect(record._id).toBeDefined();
    });
  });

  describe("autoId disabled", () => {
    it("does not generate an id when autoId is false", async () => {
      const r = new MemoryRepository<User>({ autoId: false });
      const user = await r.save({ id: "manual-id", name: "Alice", email: "alice@example.com", age: 30 });
      expect(user.id).toBe("manual-id");
    });
  });

  describe("describe()", () => {
    it("reports the exact operator set assertOperators accepts", () => {
      const caps = repo.describe();
      expect(caps.adapter).toBe("@mantlejs/memory");
      expect(new Set(caps.operators)).toEqual(MEMORY_OPERATORS);
      expect(caps.pagination).toBe("offset");
      expect(caps.fullTextSearch).toBe(false);
    });

    it("findAll rejects an unsupported operator naming the adapter", async () => {
      repo.seed([{ id: "1", name: "Alice", email: "alice@example.com", age: 30 }]);
      await expect(repo.findAll({ where: { name: { $regex: "^A" } } })).rejects.toMatchObject({
        message: expect.stringContaining("@mantlejs/memory"),
      });
    });
  });
});
