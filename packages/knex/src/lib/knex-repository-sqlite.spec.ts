import { afterEach, beforeEach, describe, expect, it } from "vitest";
import knexLib from "knex";
import type { Knex } from "knex";
import type { HookContext, MantleApplication } from "@mantlejs/mantle";
import { Conflict, conditional, mantle, NotFound, PreconditionFailed, RepositoryService } from "@mantlejs/mantle";
import { KnexRepository } from "./knex-repository.js";

/**
 * Real-database checks (in-memory SQLite via better-sqlite3) for behavior the mocked specs can't prove:
 * a duplicate-id `save()` is rejected atomically by the database and surfaces as `Conflict` — the
 * insert-if-absent that `@mantlejs/idempotency` uses as its lock (Phase 8 PRD Decision #6).
 */
interface Item extends Record<string, unknown> {
  id: string;
  value: string;
}

class ItemRepository extends KnexRepository<Item> {
  readonly tableName = "items";
  override readonly timestamps = false;
}

describe("KnexRepository on SQLite — duplicate id", () => {
  let db: Knex;
  let app: MantleApplication;

  beforeEach(async () => {
    db = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    await db.schema.createTable("items", (table) => {
      table.string("id").primary();
      table.string("value");
    });
    app = mantle().set("knex", db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("throws Conflict and leaves the existing row untouched", async () => {
    const repo = new ItemRepository(app);
    await repo.save({ id: "k1", value: "first" });
    await expect(repo.save({ id: "k1", value: "second" })).rejects.toBeInstanceOf(Conflict);
    await expect(repo.findById("k1")).resolves.toEqual({ id: "k1", value: "first" });
  });

  it("deleteById removes the row and returns it (knex's SQLite dialect ignores RETURNING on DELETE)", async () => {
    const repo = new ItemRepository(app);
    await repo.save({ id: "k1", value: "first" });
    await expect(repo.deleteById("k1")).resolves.toEqual({ id: "k1", value: "first" });
    await expect(repo.findById("k1")).resolves.toBeNull();
  });

  it("lets exactly one of several concurrent saves of the same id win", async () => {
    const repo = new ItemRepository(app);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => repo.save({ id: "k1", value: `attempt-${i}` })),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(rejected).toHaveLength(4);
    expect(rejected.every((o) => o.reason instanceof Conflict)).toBe(true);
  });
});

describe("KnexRepository on SQLite — timestamps", () => {
  let db: Knex;
  let app: MantleApplication;

  class StampedRepository extends KnexRepository<Item & { createdAt?: Date; updatedAt?: Date }> {
    readonly tableName = "stamped";
  }

  beforeEach(async () => {
    db = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    await db.schema.createTable("stamped", (table) => {
      table.string("id").primary();
      table.string("value");
      table.datetime("createdAt");
      table.datetime("updatedAt");
    });
    app = mantle().set("knex", db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns createdAt/updatedAt as Dates that serialize as RFC 3339, not epoch numbers", async () => {
    const repo = new StampedRepository(app);
    const saved = await repo.save({ id: "s1", value: "x" });
    const found = await repo.findById("s1");
    for (const entity of [saved, found]) {
      expect(entity?.createdAt).toBeInstanceOf(Date);
      expect(JSON.parse(JSON.stringify(entity))["updatedAt"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});

describe("KnexRepository on SQLite — WriteOptions.where and conditional()", () => {
  let db: Knex;
  let app: MantleApplication;

  interface Versioned extends Record<string, unknown> {
    id: string;
    title: string;
    version: number;
  }

  class VersionedRepository extends KnexRepository<Versioned> {
    readonly tableName = "versioned";
    override readonly timestamps = false;
  }

  beforeEach(async () => {
    db = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    await db.schema.createTable("versioned", (table) => {
      table.string("id").primary();
      table.string("title");
      table.integer("version");
    });
    await db("versioned").insert({ id: "v1", title: "A", version: 1 });
    app = mantle().set("knex", db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it.each(["updateById", "patchById", "deleteById"] as const)(
    "%s applies only while the precondition holds, in the same statement",
    async (method) => {
      const repo = new VersionedRepository(app);
      const run = (version: number) =>
        method === "deleteById"
          ? repo.deleteById("v1", { where: { version } })
          : repo[method]("v1", { id: "v1", title: "B", version: 2 }, { where: { version } });
      await expect(run(9)).rejects.toBeInstanceOf(PreconditionFailed);
      await expect(repo.findById("v1")).resolves.toMatchObject({ title: "A", version: 1 });
      await expect(run(1)).resolves.toMatchObject({ id: "v1" });
    },
  );

  it("still reports a missing id as NotFound without a precondition", async () => {
    await expect(new VersionedRepository(app).patchById("nope", { title: "x" })).rejects.toBeInstanceOf(NotFound);
  });

  it("makes conditional() writes atomic: a change landing after the If-Match check wins, not the stale write", async () => {
    const repo = new VersionedRepository(app);
    app.use("versioned", new RepositoryService<Versioned>(repo));
    const etags = conditional({ versionField: "version" });
    const concurrentWrite = async (context: HookContext) => {
      if (context.method === "patch") await db("versioned").where({ id: "v1" }).update({ title: "Theirs", version: 2 });
      return context;
    };
    app.service("versioned").hooks({ before: { all: [etags.before, concurrentWrite] }, after: { all: [etags.after] } });

    const error = await app
      .service<Versioned>("versioned")
      .patch("v1", { title: "Mine" }, { provider: "rest", headers: { "if-match": '"1"' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreconditionFailed);
    expect((error as Error).message).toMatch(/no longer matches the write's precondition/);
    await expect(repo.findById("v1")).resolves.toMatchObject({ title: "Theirs", version: 2 });
  });
});
