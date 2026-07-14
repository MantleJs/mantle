import { describe, expect, it, vi } from "vitest";
import type { Id, QueryParams, Repository } from "./types.js";
import { BadRequest, NotFound } from "./errors.js";
import { RepositoryService } from "./repository-service.js";

interface User {
  id: number;
  name: string;
  age: number;
  active: boolean;
}

/** Minimal fake — records the QueryParams it was called with. */
function makeRepo(rows: User[] = []): Repository<User> & { calls: QueryParams[] } {
  const calls: QueryParams[] = [];
  return {
    calls,
    findAll: vi.fn(async (params?: QueryParams) => {
      calls.push(params ?? {});
      return rows;
    }),
    findById: vi.fn(async (id: Id) => rows.find((r) => r.id === id) ?? null),
    save: vi.fn(async (data: Partial<User>) => ({ id: 1, ...data }) as User),
    saveAll: vi.fn(async (data: Partial<User>[]) => data.map((d, i) => ({ id: i + 1, ...d }) as User)),
    updateById: vi.fn(async (id: Id, data: Partial<User>) => {
      if (!rows.some((r) => r.id === id)) throw new NotFound(`No record found for id '${String(id)}'`);
      return { id, ...data } as User;
    }),
    patchById: vi.fn(async (id: Id, data: Partial<User>) => {
      if (!rows.some((r) => r.id === id)) throw new NotFound(`No record found for id '${String(id)}'`);
      return { id, ...data } as User;
    }),
    deleteById: vi.fn(async (id: Id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFound(`No record found for id '${String(id)}'`);
      return row;
    }),
    count: vi.fn(async () => rows.length),
  };
}

const userSchema = {
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    age: { type: "number" },
    active: { type: "boolean" },
  },
};

describe("RepositoryService — reserved keys", () => {
  it("splits $limit/$skip/$sort/$select from where", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo);

    await svc.find({ query: { name: "Alice", $limit: "10", $skip: "5", $sort: { name: "asc" }, $select: ["name"] } });

    expect(repo.calls[0]).toEqual({
      where: { name: "Alice" },
      limit: 10,
      skip: 5,
      sort: { name: "asc" },
      select: ["name"],
    });
  });

  it("accepts 1/-1 sort directions and normalizes to asc/desc", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo);
    await svc.find({ query: { $sort: { name: "1", age: "-1" } } });
    expect(repo.calls[0].sort).toEqual({ name: "asc", age: "desc" });
  });

  it("accepts a bare string $select as a singleton array", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo);
    await svc.find({ query: { $select: "name" } });
    expect(repo.calls[0].select).toEqual(["name"]);
  });

  it("rejects malformed $limit, $skip, and $sort values", async () => {
    const svc = new RepositoryService(makeRepo());
    await expect(svc.find({ query: { $limit: "abc" } })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.find({ query: { $limit: "-1" } })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.find({ query: { $skip: "1.5" } })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.find({ query: { $sort: { name: "up" } } })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.find({ query: { $sort: "name" } })).rejects.toBeInstanceOf(BadRequest);
  });
});

describe("RepositoryService — pagination envelope", () => {
  const rows: User[] = [
    { id: 1, name: "Alice", age: 30, active: true },
    { id: 2, name: "Bob", age: 25, active: false },
  ];

  it("always returns Paginated with total from repository.count", async () => {
    const repo = makeRepo(rows);
    const svc = new RepositoryService(repo);
    const result = await svc.find();
    expect(result).toEqual({ total: 2, limit: 2, skip: 0, data: rows });
  });

  it("applies the paginate default when no $limit is given", async () => {
    const repo = makeRepo(rows);
    const svc = new RepositoryService(repo, { paginate: { default: 10, max: 50 } });
    const result = await svc.find();
    expect(repo.calls[0].limit).toBe(10);
    expect(result.limit).toBe(10);
  });

  it("caps $limit at paginate.max", async () => {
    const repo = makeRepo(rows);
    const svc = new RepositoryService(repo, { paginate: { default: 10, max: 50 } });
    const result = await svc.find({ query: { $limit: "500" } });
    expect(repo.calls[0].limit).toBe(50);
    expect(result.limit).toBe(50);
  });

  it("counts with the same where but without limit/skip", async () => {
    const repo = makeRepo(rows);
    const svc = new RepositoryService(repo);
    await svc.find({ query: { name: "Alice", $limit: "1", $skip: "1" } });
    expect(repo.count).toHaveBeenCalledWith({ where: { name: "Alice" } });
  });
});

describe("RepositoryService — field whitelist", () => {
  const options = { fields: ["name", "age"] };

  it("allows whitelisted fields", async () => {
    const svc = new RepositoryService(makeRepo(), options);
    await expect(svc.find({ query: { name: "Alice", $sort: { age: "asc" } } })).resolves.toBeDefined();
  });

  it("rejects unlisted where fields, naming the field and the allowed set", async () => {
    const svc = new RepositoryService(makeRepo(), options);
    await expect(svc.find({ query: { password: "x" } })).rejects.toThrow(
      "Field 'password' is not queryable. Allowed: name, age",
    );
  });

  it("carries an actionable hint on the whitelist error", async () => {
    const svc = new RepositoryService(makeRepo(), options);
    await expect(svc.find({ query: { password: "x" } })).rejects.toMatchObject({
      hint: expect.stringContaining("allowed fields"),
    });
  });

  it("rejects unlisted fields nested in $or", async () => {
    const svc = new RepositoryService(makeRepo(), options);
    await expect(svc.find({ query: { $or: [{ name: "a" }, { secret: "x" }] } })).rejects.toThrow(/secret/);
  });

  it("rejects unlisted sort and select fields", async () => {
    const svc = new RepositoryService(makeRepo(), options);
    await expect(svc.find({ query: { $sort: { secret: "asc" } } })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.find({ query: { $select: ["secret"] } })).rejects.toBeInstanceOf(BadRequest);
  });

  it("does not treat operator keys as fields", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo, options);
    await expect(svc.find({ query: { age: { $gt: "21" } } })).resolves.toBeDefined();
  });
});

describe("RepositoryService — schema coercion", () => {
  it("coerces bare values, operator values, and $in arrays", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo, { schema: userSchema });

    await svc.find({
      query: { age: { $gt: "21", $in: ["30", "40"] }, active: "true", id: "7" },
    });

    expect(repo.calls[0].where).toEqual({
      age: { $gt: 21, $in: [30, 40] },
      active: true,
      id: 7,
    });
  });

  it("coerces recursively inside $or branches", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo, { schema: userSchema });
    await svc.find({ query: { $or: [{ age: { $lt: "18" } }, { active: "false" }] } });
    expect(repo.calls[0].where).toEqual({ $or: [{ age: { $lt: 18 } }, { active: false }] });
  });

  it("throws BadRequest for uncoercible values", async () => {
    const svc = new RepositoryService(makeRepo(), { schema: userSchema });
    await expect(svc.find({ query: { age: "not-a-number" } })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.find({ query: { active: "yes" } })).rejects.toBeInstanceOf(BadRequest);
  });

  it("passes strings through unchanged without a schema", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo);
    await svc.find({ query: { age: { $gt: "21" } } });
    expect(repo.calls[0].where).toEqual({ age: { $gt: "21" } });
  });

  it("leaves fields not in the schema untouched", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo, { schema: userSchema });
    await svc.find({ query: { nickname: "42" } });
    expect(repo.calls[0].where).toEqual({ nickname: "42" });
  });
});

describe("RepositoryService — CRUD passthrough", () => {
  const rows: User[] = [{ id: 1, name: "Alice", age: 30, active: true }];

  it("get returns the record and throws NotFound for null", async () => {
    const svc = new RepositoryService(makeRepo(rows));
    await expect(svc.get(1)).resolves.toEqual(rows[0]);
    await expect(svc.get(999)).rejects.toBeInstanceOf(NotFound);
  });

  it("create dispatches single objects to save and arrays to saveAll", async () => {
    const repo = makeRepo();
    const svc = new RepositoryService(repo);
    await svc.create({ name: "Zed" });
    expect(repo.save).toHaveBeenCalledWith({ name: "Zed" });
    await svc.create([{ name: "A" }, { name: "B" }]);
    expect(repo.saveAll).toHaveBeenCalledWith([{ name: "A" }, { name: "B" }]);
  });

  it("update/patch/remove propagate the repository's NotFound untouched", async () => {
    const svc = new RepositoryService(makeRepo(rows));
    await expect(svc.update(999, { name: "X" })).rejects.toBeInstanceOf(NotFound);
    await expect(svc.patch(999, { name: "X" })).rejects.toBeInstanceOf(NotFound);
    await expect(svc.remove(999)).rejects.toBeInstanceOf(NotFound);
  });
});
