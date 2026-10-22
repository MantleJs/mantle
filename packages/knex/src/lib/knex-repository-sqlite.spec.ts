import { afterEach, beforeEach, describe, expect, it } from "vitest";
import knexLib from "knex";
import type { Knex } from "knex";
import type { MantleApplication } from "@mantlejs/mantle";
import { Conflict, mantle } from "@mantlejs/mantle";
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
