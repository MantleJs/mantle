import { describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import type { MantleApplication } from "@mantlejs/mantle";
import { GeneralError, NotFound } from "@mantlejs/mantle";
import { KnexVectorRepository } from "./knex-vector-repository.js";
import type { DistanceOperator } from "./knex-vector-repository.js";

interface Article extends Record<string, unknown> {
  id: string;
  title: string;
  embedding: string;
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
    orderByRaw: vi.fn(),
    offset: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    first: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    returning: vi.fn(),
    count: vi.fn(),
    onConflict: vi.fn(),
    merge: vi.fn(),
  };
  const terminal = new Set(["select", "first", "returning", "count"]);
  for (const key of Object.keys(qb)) {
    if (!terminal.has(key)) {
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
  const rawResult = { __isRaw: true };
  const knexFn = vi.fn().mockReturnValue(qb) as unknown as Knex;
  (knexFn as unknown as Record<string, unknown>)["client"] = { config: { client: clientName } };
  (knexFn as unknown as Record<string, unknown>)["transaction"] = vi.fn();
  (knexFn as unknown as Record<string, unknown>)["raw"] = vi.fn().mockReturnValue(rawResult);
  const app = {
    get: vi.fn().mockReturnValue(knexFn),
    set: vi.fn().mockReturnThis(),
  } as unknown as MantleApplication;
  return { qb, knexFn, app, rawResult };
}

// ─── Concrete test repositories ───────────────────────────────────────────────

class TestVectorRepo extends KnexVectorRepository<Article> {
  readonly tableName = "articles";
  override readonly timestamps = false;
}

class TestVectorRepoWithTimestamps extends KnexVectorRepository<Article> {
  readonly tableName = "articles";
}

class TestVectorRepoL2 extends KnexVectorRepository<Article> {
  readonly tableName = "articles";
  override readonly timestamps = false;
  override readonly distanceOperator: DistanceOperator = "<->";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KnexVectorRepository", () => {
  describe("defaults", () => {
    it("vectorColumn defaults to 'embedding'", () => {
      const { app } = makeSetup([]);
      expect(new TestVectorRepo(app).vectorColumn).toBe("embedding");
    });

    it("distanceOperator defaults to '<=>'", () => {
      const { app } = makeSetup([]);
      expect(new TestVectorRepo(app).distanceOperator).toBe("<=>");
    });
  });

  describe("findSimilar", () => {
    it("passes the distance expression to select via knex.raw", async () => {
      const { knexFn, app } = makeSetup([]);
      await new TestVectorRepo(app).findSimilar([0.1, 0.2, 0.3], 5);
      expect((knexFn as unknown as Record<string, unknown>)["raw"]).toHaveBeenCalledWith(
        "*, ?? <=> ?::vector AS _distance",
        ["embedding", "[0.1,0.2,0.3]"],
      );
    });

    it("calls orderByRaw with the distance expression", async () => {
      const { qb, app } = makeSetup([]);
      await new TestVectorRepo(app).findSimilar([0.1, 0.2], 5);
      expect(qb["orderByRaw"]).toHaveBeenCalledWith("?? <=> ?::vector", ["embedding", "[0.1,0.2]"]);
    });

    it("limits results to topK", async () => {
      const { qb, app } = makeSetup([]);
      await new TestVectorRepo(app).findSimilar([0.1], 10);
      expect(qb["limit"]).toHaveBeenCalledWith(10);
    });

    it("returns the rows from the query", async () => {
      const rows = [{ id: "1", title: "Doc", embedding: "[0.1]", _distance: 0.05 }];
      const { app } = makeSetup(rows);
      const result = await new TestVectorRepo(app).findSimilar([0.1], 5);
      expect(result).toEqual(rows);
    });

    it("applies where clause from params", async () => {
      const { qb, app } = makeSetup([]);
      await new TestVectorRepo(app).findSimilar([0.1], 5, { where: { published: true } });
      expect(qb["where"]).toHaveBeenCalledWith("published", "=", true);
    });

    it("applies skip from params", async () => {
      const { qb, app } = makeSetup([]);
      await new TestVectorRepo(app).findSimilar([0.1], 5, { skip: 20 });
      expect(qb["offset"]).toHaveBeenCalledWith(20);
    });

    it("uses the custom distanceOperator", async () => {
      const { qb, knexFn, app } = makeSetup([]);
      await new TestVectorRepoL2(app).findSimilar([0.1], 5);
      expect(qb["orderByRaw"]).toHaveBeenCalledWith("?? <-> ?::vector", ["embedding", "[0.1]"]);
      expect((knexFn as unknown as Record<string, unknown>)["raw"]).toHaveBeenCalledWith(
        "*, ?? <-> ?::vector AS _distance",
        ["embedding", "[0.1]"],
      );
    });

    it("throws GeneralError for non-pg clients", async () => {
      const { app } = makeSetup([], "mysql");
      await expect(new TestVectorRepo(app).findSimilar([0.1], 5)).rejects.toBeInstanceOf(GeneralError);
    });

    it("wraps database errors via wrapError", async () => {
      const { qb, app } = makeSetup([]);
      qb["select"].mockRejectedValue(new Error("connection refused"));
      await expect(new TestVectorRepo(app).findSimilar([0.1], 5)).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("upsertVector", () => {
    it("returns the upserted row", async () => {
      const row = { id: "1", title: "Doc", embedding: "[0.1,0.2]" };
      const { app } = makeSetup([row]);
      expect(await new TestVectorRepo(app).upsertVector("1", [0.1, 0.2], { title: "Doc" })).toEqual(row);
    });

    it("inserts with the record id in the payload", async () => {
      const { qb, app } = makeSetup([{ id: "1" }]);
      await new TestVectorRepo(app).upsertVector("1", [0.1], { title: "Doc" });
      const [insertPayload] = qb["insert"].mock.calls[0] as [Record<string, unknown>];
      expect(insertPayload).toHaveProperty("id", "1");
    });

    it("includes the vector raw expression in the insert payload", async () => {
      const { qb, app, rawResult } = makeSetup([{ id: "1" }]);
      await new TestVectorRepo(app).upsertVector("1", [0.1, 0.2], {});
      const [insertPayload] = qb["insert"].mock.calls[0] as [Record<string, unknown>];
      expect(insertPayload["embedding"]).toBe(rawResult);
    });

    it("calls onConflict with the idField", async () => {
      const { qb, app } = makeSetup([{ id: "1" }]);
      await new TestVectorRepo(app).upsertVector("1", [0.1], {});
      expect(qb["onConflict"]).toHaveBeenCalledWith("id");
    });

    it("passes merge payload to merge()", async () => {
      const { qb, app, rawResult } = makeSetup([{ id: "1" }]);
      await new TestVectorRepo(app).upsertVector("1", [0.1], { title: "Doc" });
      const [mergePayload] = qb["merge"].mock.calls[0] as [Record<string, unknown>];
      expect(mergePayload).toHaveProperty("title", "Doc");
      expect(mergePayload["embedding"]).toBe(rawResult);
    });

    it("adds createdAt and updatedAt to insert payload when timestamps is true", async () => {
      const { qb, app } = makeSetup([{ id: "1" }]);
      await new TestVectorRepoWithTimestamps(app).upsertVector("1", [0.1], {});
      const [insertPayload] = qb["insert"].mock.calls[0] as [Record<string, unknown>];
      expect(insertPayload).toHaveProperty("createdAt");
      expect(insertPayload).toHaveProperty("updatedAt");
      expect(insertPayload["createdAt"]).toBeInstanceOf(Date);
    });

    it("adds only updatedAt to merge payload when timestamps is true", async () => {
      const { qb, app } = makeSetup([{ id: "1" }]);
      await new TestVectorRepoWithTimestamps(app).upsertVector("1", [0.1], {});
      const [mergePayload] = qb["merge"].mock.calls[0] as [Record<string, unknown>];
      expect(mergePayload).toHaveProperty("updatedAt");
      expect(mergePayload).not.toHaveProperty("createdAt");
    });

    it("does not add timestamps to payloads when timestamps is false", async () => {
      const { qb, app } = makeSetup([{ id: "1" }]);
      await new TestVectorRepo(app).upsertVector("1", [0.1], {});
      const [insertPayload] = qb["insert"].mock.calls[0] as [Record<string, unknown>];
      const [mergePayload] = qb["merge"].mock.calls[0] as [Record<string, unknown>];
      expect(insertPayload).not.toHaveProperty("createdAt");
      expect(insertPayload).not.toHaveProperty("updatedAt");
      expect(mergePayload).not.toHaveProperty("updatedAt");
    });

    it("throws GeneralError for non-pg clients", async () => {
      const { app } = makeSetup([], "mysql");
      await expect(new TestVectorRepo(app).upsertVector("1", [0.1], {})).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("deleteVector", () => {
    it("deletes and returns the record", async () => {
      const row = { id: "1", title: "Doc", embedding: "[0.1]" };
      const { app } = makeSetup([row]);
      expect(await new TestVectorRepo(app).deleteVector("1")).toEqual(row);
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup([]);
      await expect(new TestVectorRepo(app).deleteVector("999")).rejects.toBeInstanceOf(NotFound);
    });

    it("throws GeneralError for non-pg clients", async () => {
      const { app } = makeSetup([], "mysql");
      await expect(new TestVectorRepo(app).deleteVector("1")).rejects.toBeInstanceOf(GeneralError);
    });
  });
});
