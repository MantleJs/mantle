import { describe, it, expect } from "vitest";
import { repositoryTemplate } from "./repository.js";

describe("repositoryTemplate", () => {
  it("extends KnexRepository with a tableName for the knex backend", () => {
    const src = repositoryTemplate("Items", "item", "knex");
    expect(src).toContain('import { KnexRepository } from "@mantlejs/knex";');
    expect(src).toContain("extends KnexRepository<Items>");
    expect(src).toContain('readonly tableName = "items";');
  });

  it("extends MongoRepository with a collectionName for the mongodb backend", () => {
    const src = repositoryTemplate("Items", "item", "mongodb");
    expect(src).toContain('import { MongoRepository } from "@mantlejs/mongodb";');
    expect(src).toContain("extends MongoRepository<Items>");
    expect(src).toContain('readonly collectionName = "items";');
  });

  it("extends MemoryRepository directly for the memory backend", () => {
    const src = repositoryTemplate("Items", "item", "memory");
    expect(src).toContain('import { MemoryRepository } from "@mantlejs/memory";');
    expect(src).toContain("extends MemoryRepository<Items> {}");
  });
});
