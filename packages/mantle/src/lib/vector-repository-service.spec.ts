import { describe, expect, it, vi } from "vitest";
import type { Id, QueryParams, VectorRepository } from "./types.js";
import { BadRequest } from "./errors.js";
import { VectorRepositoryService } from "./vector-repository-service.js";

interface Doc extends Record<string, unknown> {
  id: string;
  title: string;
  category: string;
}

/** Minimal fake — findSimilar echoes its arguments back through the results. */
function makeRepo(): VectorRepository<Doc> & { similarCalls: Array<[number[], number, QueryParams | undefined]> } {
  const similarCalls: Array<[number[], number, QueryParams | undefined]> = [];
  return {
    similarCalls,
    findSimilar: vi.fn(async (vector: number[], topK: number, params?: QueryParams) => {
      similarCalls.push([vector, topK, params]);
      return [{ id: "1", title: "A", category: "x", _score: 0.97 }];
    }),
    upsertVector: vi.fn(async (id: Id, _vector: number[], data: Partial<Doc>) => ({ id: String(id), ...data }) as Doc),
    deleteVector: vi.fn(async (id: Id) => ({ id: String(id) }) as Doc),
    findAll: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    save: vi.fn(async (data: Partial<Doc>) => data as Doc),
    saveAll: vi.fn(async (data: Partial<Doc>[]) => data as Doc[]),
    updateById: vi.fn(async (id: Id, data: Partial<Doc>) => ({ id: String(id), ...data }) as Doc),
    patchById: vi.fn(async (id: Id, data: Partial<Doc>) => ({ id: String(id), ...data }) as Doc),
    deleteById: vi.fn(async (id: Id) => ({ id: String(id) }) as Doc),
    count: vi.fn(async () => 0),
  };
}

describe("VectorRepositoryService.similar", () => {
  it("forwards vector, topK, and where to repository.findSimilar and returns _score-bearing results", async () => {
    const repo = makeRepo();
    const svc = new VectorRepositoryService(repo);

    const results = await svc.similar({ vector: [0.1, 0.2], topK: 5, where: { category: "x" } });

    expect(repo.similarCalls[0]).toEqual([[0.1, 0.2], 5, { where: { category: "x" } }]);
    expect(results[0]._score).toBe(0.97);
  });

  it("defaults topK to 10 and omits QueryParams when no where is given", async () => {
    const repo = makeRepo();
    await new VectorRepositoryService(repo).similar({ vector: [1, 2, 3] });
    expect(repo.similarCalls[0]).toEqual([[1, 2, 3], 10, undefined]);
  });

  it("applies options.topK default and caps requests at max", async () => {
    const repo = makeRepo();
    const svc = new VectorRepositoryService(repo, { topK: { default: 3, max: 20 } });

    await svc.similar({ vector: [1] });
    expect(repo.similarCalls[0][1]).toBe(3);

    await svc.similar({ vector: [1], topK: 500 });
    expect(repo.similarCalls[1][1]).toBe(20);
  });

  it("rejects a missing or non-numeric vector with BadRequest", async () => {
    const repo = makeRepo();
    const svc = new VectorRepositoryService(repo);

    await expect(svc.similar(undefined as never)).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.similar({} as never)).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.similar({ vector: [] })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.similar({ vector: ["a", "b"] as never })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.similar({ vector: [1, Number.NaN] })).rejects.toBeInstanceOf(BadRequest);
    expect(repo.findSimilar).not.toHaveBeenCalled();
  });

  it("rejects a non-positive or fractional topK with BadRequest", async () => {
    const svc = new VectorRepositoryService(makeRepo());
    await expect(svc.similar({ vector: [1], topK: 0 })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.similar({ vector: [1], topK: -3 })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.similar({ vector: [1], topK: 2.5 })).rejects.toBeInstanceOf(BadRequest);
  });

  it("rejects a non-object where with BadRequest", async () => {
    const svc = new VectorRepositoryService(makeRepo());
    await expect(svc.similar({ vector: [1], where: [] as never })).rejects.toBeInstanceOf(BadRequest);
  });

  it("enforces the options.fields whitelist on where keys", async () => {
    const repo = makeRepo();
    const svc = new VectorRepositoryService(repo, { fields: ["category"] });

    await expect(svc.similar({ vector: [1], where: { secret: "x" } })).rejects.toBeInstanceOf(BadRequest);
    expect(repo.findSimilar).not.toHaveBeenCalled();

    await svc.similar({ vector: [1], where: { category: "x" } });
    expect(repo.similarCalls[0][2]).toEqual({ where: { category: "x" } });
  });

  it("inherits RepositoryService behavior for the standard methods", async () => {
    const repo = makeRepo();
    const svc = new VectorRepositoryService(repo);
    const page = await svc.find({ query: {} });
    expect(page).toMatchObject({ total: 0, skip: 0, data: [] });
  });
});
