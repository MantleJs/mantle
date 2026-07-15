import { describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import type { MantleApplication } from "@mantlejs/mantle";
import { BadRequest, Conflict, Forbidden, GeneralError, NotFound, Unavailable, Unprocessable } from "@mantlejs/mantle";
import { KnexRepository } from "./knex-repository.js";
import { KNEX_OPERATORS } from "./knexify.js";

interface User extends Record<string, unknown> {
  id: number;
  name: string;
  email: string;
}

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeQb(resolveWith: unknown) {
  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    whereNull: vi.fn(),
    whereNotNull: vi.fn(),
    whereNot: vi.fn(),
    whereIn: vi.fn(),
    whereNotIn: vi.fn(),
    whereLike: vi.fn(),
    whereNotLike: vi.fn(),
    whereILike: vi.fn(),
    orderBy: vi.fn(),
    offset: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    first: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    returning: vi.fn(),
    count: vi.fn(),
  };
  for (const key of Object.keys(qb)) {
    if (!["select", "first", "returning", "count"].includes(key)) {
      qb[key].mockReturnValue(qb);
    }
  }
  qb["select"].mockResolvedValue(resolveWith);
  qb["first"].mockResolvedValue(resolveWith);
  qb["returning"].mockResolvedValue(resolveWith);
  qb["count"].mockResolvedValue(resolveWith);
  return qb;
}

function makeSetup(resolveWith: unknown, clientName = "pg") {
  const qb = makeQb(resolveWith);
  const knexFn = vi.fn().mockReturnValue(qb) as unknown as Knex;
  (knexFn as unknown as Record<string, unknown>)["client"] = { config: { client: clientName } };
  (knexFn as unknown as Record<string, unknown>)["transaction"] = vi.fn();
  const app = {
    get: vi.fn().mockReturnValue(knexFn),
    set: vi.fn().mockReturnThis(),
  } as unknown as MantleApplication;
  return { qb, knexFn, app };
}

// ─── Concrete test repositories ───────────────────────────────────────────────

class TestRepo extends KnexRepository<User> {
  readonly tableName = "users";
  override readonly timestamps = false;
}

class TestRepoWithTimestamps extends KnexRepository<User> {
  readonly tableName = "users";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KnexRepository", () => {
  describe("constructor, db getter, defaults", () => {
    it("retrieves the knex instance from app", () => {
      const { app, knexFn } = makeSetup([]);
      new TestRepo(app);
      expect(app.get).toHaveBeenCalledWith("knex");
      expect(app.get).toHaveReturnedWith(knexFn);
    });

    it("db getter returns a query builder for the table", () => {
      const { qb, app, knexFn } = makeSetup([]);
      const repo = new TestRepo(app);
      const builder = repo.db;
      expect(knexFn).toHaveBeenCalledWith("users");
      expect(builder).toBe(qb);
    });

    it("defaults idField to 'id'", () => {
      const { app } = makeSetup([]);
      expect(new TestRepo(app).idField).toBe("id");
    });

    it("defaults timestamps to true", () => {
      const { app } = makeSetup([]);
      expect(new TestRepoWithTimestamps(app).timestamps).toBe(true);
    });
  });

  describe("findAll", () => {
    it("selects all columns by default", async () => {
      const users = [{ id: 1, name: "Alice", email: "alice@example.com" }];
      const { qb, app } = makeSetup(users);
      const result = await new TestRepo(app).findAll();
      expect(result).toEqual(users);
      expect(qb["select"]).toHaveBeenCalledWith("*");
    });

    it("applies query operators via knexify ($gt)", async () => {
      const { qb, app } = makeSetup([]);
      await new TestRepo(app).findAll({ where: { age: { $gt: 18 } } });
      expect(qb["where"]).toHaveBeenCalledWith("age", ">", 18);
    });

    it("applies equality where clause", async () => {
      const { qb, app } = makeSetup([]);
      await new TestRepo(app).findAll({ where: { name: "Alice" } });
      expect(qb["where"]).toHaveBeenCalledWith("name", "=", "Alice");
    });

    it("applies sort, skip, and limit", async () => {
      const { qb, app } = makeSetup([]);
      await new TestRepo(app).findAll({ sort: { name: "asc" }, skip: 10, limit: 5 });
      expect(qb["orderBy"]).toHaveBeenCalledWith("name", "asc");
      expect(qb["offset"]).toHaveBeenCalledWith(10);
      expect(qb["limit"]).toHaveBeenCalledWith(5);
    });

    it("selects specific columns when params.select is provided", async () => {
      const { qb, app } = makeSetup([]);
      await new TestRepo(app).findAll({ select: ["id", "name"] });
      expect(qb["select"]).toHaveBeenCalledWith(["id", "name"]);
    });

    it("wraps db errors as GeneralError", async () => {
      const { qb, app } = makeSetup([]);
      qb["select"].mockRejectedValue(new Error("connection refused"));
      await expect(new TestRepo(app).findAll()).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("findById", () => {
    it("returns the row when found", async () => {
      const user = { id: 1, name: "Alice", email: "alice@example.com" };
      const { qb, app } = makeSetup(user);
      const result = await new TestRepo(app).findById(1);
      expect(result).toEqual(user);
      expect(qb["where"]).toHaveBeenCalledWith({ id: 1 });
    });

    it("returns null when no row is found", async () => {
      const { app } = makeSetup(undefined);
      expect(await new TestRepo(app).findById(999)).toBeNull();
    });
  });

  describe("save (pg — RETURNING * path)", () => {
    it("inserts and returns the row", async () => {
      const user = { id: 1, name: "Alice", email: "alice@example.com" };
      const { app } = makeSetup([user]);
      expect(await new TestRepo(app).save({ name: "Alice", email: "alice@example.com" })).toEqual(user);
    });

    it("adds createdAt and updatedAt when timestamps is true", async () => {
      const { qb, app } = makeSetup([{ id: 1 }]);
      await new TestRepoWithTimestamps(app).save({ name: "Alice", email: "alice@example.com" });
      const [inserted] = qb["insert"].mock.calls[0] as [Record<string, unknown>];
      expect(inserted).toHaveProperty("createdAt");
      expect(inserted).toHaveProperty("updatedAt");
      expect(inserted["createdAt"]).toBeInstanceOf(Date);
    });

    it("does not add timestamps when timestamps is false", async () => {
      const { qb, app } = makeSetup([{ id: 1 }]);
      await new TestRepo(app).save({ name: "Alice", email: "alice@example.com" });
      const [inserted] = qb["insert"].mock.calls[0] as [Record<string, unknown>];
      expect(inserted).not.toHaveProperty("createdAt");
    });
  });

  describe("saveAll", () => {
    it("batch-inserts and returns all rows", async () => {
      const users = [
        { id: 1, name: "Alice", email: "alice@example.com" },
        { id: 2, name: "Bob", email: "bob@example.com" },
      ];
      const { app } = makeSetup(users);
      const result = await new TestRepo(app).saveAll([
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ]);
      expect(result).toEqual(users);
    });

    it("stamps all rows with the same createdAt timestamp", async () => {
      const { qb, app } = makeSetup([{ id: 1 }, { id: 2 }]);
      await new TestRepoWithTimestamps(app).saveAll([
        { name: "Alice", email: "a@a.com" },
        { name: "Bob", email: "b@b.com" },
      ]);
      const [payload] = qb["insert"].mock.calls[0] as [Array<Record<string, unknown>>];
      expect(payload[0]).toHaveProperty("createdAt");
      expect(payload[1]).toHaveProperty("createdAt");
      expect(payload[0]["createdAt"]).toBe(payload[1]["createdAt"]);
    });
  });

  describe("updateById", () => {
    it("updates and returns the row", async () => {
      const user = { id: 1, name: "Alice Updated", email: "alice@example.com" };
      const { qb, app } = makeSetup([user]);
      const result = await new TestRepo(app).updateById(1, { name: "Alice Updated", email: "alice@example.com" });
      expect(result).toEqual(user);
      expect(qb["where"]).toHaveBeenCalledWith({ id: 1 });
    });

    it("adds updatedAt but not createdAt when timestamps is true", async () => {
      const { qb, app } = makeSetup([{ id: 1 }]);
      await new TestRepoWithTimestamps(app).updateById(1, { name: "Alice" });
      const [payload] = qb["update"].mock.calls[0] as [Record<string, unknown>];
      expect(payload).toHaveProperty("updatedAt");
      expect(payload).not.toHaveProperty("createdAt");
    });

    it("throws NotFound when no rows are updated", async () => {
      const { app } = makeSetup([]);
      await expect(new TestRepo(app).updateById(999, { name: "X" })).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("patchById", () => {
    it("partially updates and returns the row", async () => {
      const user = { id: 1, name: "Patched", email: "alice@example.com" };
      const { app } = makeSetup([user]);
      expect(await new TestRepo(app).patchById(1, { name: "Patched" })).toEqual(user);
    });

    it("filters out undefined values from the patch payload", async () => {
      const { qb, app } = makeSetup([{ id: 1 }]);
      await new TestRepo(app).patchById(1, { name: "Alice", email: undefined });
      const [payload] = qb["update"].mock.calls[0] as [Record<string, unknown>];
      expect(payload).toHaveProperty("name", "Alice");
      expect(payload).not.toHaveProperty("email");
    });

    it("throws NotFound when no rows are patched", async () => {
      const { app } = makeSetup([]);
      await expect(new TestRepo(app).patchById(999, { name: "X" })).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("deleteById", () => {
    it("deletes and returns the row", async () => {
      const user = { id: 1, name: "Alice", email: "alice@example.com" };
      const { qb, app } = makeSetup([user]);
      expect(await new TestRepo(app).deleteById(1)).toEqual(user);
      expect(qb["where"]).toHaveBeenCalledWith({ id: 1 });
    });

    it("throws NotFound when the row does not exist", async () => {
      const { app } = makeSetup([]);
      await expect(new TestRepo(app).deleteById(999)).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("count", () => {
    it("returns the total row count", async () => {
      const { app } = makeSetup([{ count: "42" }]);
      expect(await new TestRepo(app).count()).toBe(42);
    });

    it("applies where operators to count query", async () => {
      const { qb, app } = makeSetup([{ count: "5" }]);
      await new TestRepo(app).count({ where: { status: "active" } });
      expect(qb["where"]).toHaveBeenCalledWith("status", "=", "active");
    });
  });

  describe("withTransaction", () => {
    it("passes a transaction-scoped copy of the repo to the callback", async () => {
      const { knexFn, app } = makeSetup([]);
      const mockTrx = {} as Knex.Transaction;
      (knexFn as unknown as Record<string, unknown>)["transaction"] = vi.fn(
        (cb: (trx: Knex.Transaction) => Promise<unknown>) => cb(mockTrx),
      );
      const repo = new TestRepo(app);
      let capturedTrx: Knex.Transaction | null = null;
      await repo.withTransaction(async (txRepo) => {
        capturedTrx = (txRepo as unknown as { _trx: Knex.Transaction })._trx;
        return null;
      });
      expect(capturedTrx).toBe(mockTrx);
    });
  });

  describe("wrapError — full SQLSTATE mapping", () => {
    async function throwsCode(code: string) {
      const { qb, app } = makeSetup([]);
      qb["select"].mockRejectedValue(Object.assign(new Error("db error"), { code }));
      return new TestRepo(app).findAll();
    }

    it("23505 (unique violation) → Conflict", async () => {
      await expect(throwsCode("23505")).rejects.toBeInstanceOf(Conflict);
    });

    it("23503 (foreign key) → BadRequest", async () => {
      await expect(throwsCode("23503")).rejects.toBeInstanceOf(BadRequest);
    });

    it("22xxx (data exception) → BadRequest", async () => {
      await expect(throwsCode("22001")).rejects.toBeInstanceOf(BadRequest);
    });

    it("08xxx (connection error) → Unavailable", async () => {
      await expect(throwsCode("08006")).rejects.toBeInstanceOf(Unavailable);
    });

    it("57xxx (operator intervention) → Unavailable", async () => {
      await expect(throwsCode("57014")).rejects.toBeInstanceOf(Unavailable);
    });

    it("28xxx (auth failure) → Forbidden", async () => {
      await expect(throwsCode("28000")).rejects.toBeInstanceOf(Forbidden);
    });

    it("42xxx (syntax/schema error) → Unprocessable", async () => {
      await expect(throwsCode("42601")).rejects.toBeInstanceOf(Unprocessable);
    });

    it("unknown codes → GeneralError", async () => {
      await expect(throwsCode("99999")).rejects.toBeInstanceOf(GeneralError);
    });

    it("non-Error throws → GeneralError", async () => {
      const { qb, app } = makeSetup([]);
      qb["select"].mockRejectedValue("string error");
      await expect(new TestRepo(app).findAll()).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("describe()", () => {
    it("reports the exact operator set assertOperators accepts", () => {
      const { app } = makeSetup([]);
      const caps = new TestRepo(app).describe();
      expect(caps.adapter).toBe("@mantlejs/knex");
      expect(new Set(caps.operators)).toEqual(KNEX_OPERATORS);
      expect(caps.pagination).toBe("offset");
      expect(caps.fullTextSearch).toBe(false);
    });
  });
});
