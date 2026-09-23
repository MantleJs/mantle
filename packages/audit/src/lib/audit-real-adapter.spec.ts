import { describe, expect, it, afterEach } from "vitest";
import knexLib from "knex";
import type { Knex } from "knex";
import type { MantleApplication } from "@mantlejs/mantle";
import { mantle, NotFound } from "@mantlejs/mantle";
import { KnexRepository } from "@mantlejs/knex";
import { auditLog } from "./audit.js";
import type { AuditRecord } from "./audit.js";

/**
 * PRD spec 11 / checklist item 6: "sink proven against @mantlejs/memory and at least one real
 * adapter" — audit.spec.ts covers @mantlejs/memory; this proves the same hook, unmodified, writes
 * real rows to a real SQL database (in-memory SQLite, no external service required) through a real
 * @mantlejs/knex Repository, including the JSON-shaped fields (`params`, `agentScope`) a SQL sink
 * has to serialize itself — the hook stays storage-agnostic, serialization is the sink's job.
 */

/** A KnexRepository sink for AuditRecord — JSON-serializes the object-shaped fields for SQL storage. */
class SqliteAuditRepository extends KnexRepository<AuditRecord> {
  readonly tableName = "audit_logs";
  override readonly timestamps = false;

  override async save(data: Partial<AuditRecord>): Promise<AuditRecord> {
    const row = await super.save(serialize(data));
    return deserialize(row);
  }

  async all(): Promise<AuditRecord[]> {
    const rows = await this.findAll();
    return rows.map(deserialize);
  }
}

function serialize(data: Partial<AuditRecord>): Record<string, unknown> {
  return {
    ...data,
    principal: data.principal !== undefined ? JSON.stringify(data.principal) : null,
    agentScope: data.agentScope !== undefined ? JSON.stringify(data.agentScope) : null,
    params: data.params !== undefined ? JSON.stringify(data.params) : null,
  };
}

function deserialize(row: Record<string, unknown>): AuditRecord {
  return {
    ...row,
    principal: typeof row["principal"] === "string" ? JSON.parse(row["principal"]) : undefined,
    agentScope: typeof row["agentScope"] === "string" ? JSON.parse(row["agentScope"]) : undefined,
    params: typeof row["params"] === "string" ? JSON.parse(row["params"]) : undefined,
  } as AuditRecord;
}

async function buildApp(): Promise<{ app: MantleApplication; db: Knex; sink: SqliteAuditRepository }> {
  const db = knexLib({ client: "better-sqlite3", connection: ":memory:", useNullAsDefault: true });
  await db.schema.createTable("audit_logs", (table) => {
    table.increments("id");
    table.text("principal");
    table.text("agentId");
    table.text("agentScope");
    table.text("delegatingUserId");
    table.text("path").notNullable();
    table.text("method").notNullable();
    table.text("params");
    table.text("status").notNullable();
    table.text("resultSummary").notNullable();
    table.text("timestamp").notNullable();
  });

  const app = mantle();
  app.set("knex", db);
  const sink = new SqliteAuditRepository(app);
  return { app, db, sink };
}

describe("auditLog() against a real @mantlejs/knex sink (SQLite)", () => {
  let db: Knex | undefined;

  afterEach(async () => {
    await db?.destroy();
    db = undefined;
  });

  it("persists a success entry as a real row, round-tripping the JSON-shaped fields", async () => {
    const built = await buildApp();
    db = built.db;

    await auditLog({ sink: built.sink })({
      app: built.app,
      service: {},
      path: "documents",
      method: "get",
      id: "doc-1",
      params: { provider: "rest", headers: {}, user: { sub: "user-1" }, query: { where: { id: "doc-1" } } },
      agent: { id: "agent-1", scope: { documents: ["get"] }, delegatingUserId: "user-1" },
      result: { id: "doc-1", title: "Hello" },
    });

    const rows = await built.sink.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      principal: { sub: "user-1" },
      agentId: "agent-1",
      agentScope: { documents: ["get"] },
      delegatingUserId: "user-1",
      path: "documents",
      method: "get",
      params: { where: { id: "doc-1" } },
      status: "success",
      resultSummary: "record id=doc-1",
    });
  });

  it("persists an error entry as a real row", async () => {
    const built = await buildApp();
    db = built.db;

    await auditLog({ sink: built.sink })({
      app: built.app,
      service: {},
      path: "documents",
      method: "get",
      params: { provider: "rest", headers: {} },
      error: new NotFound("Document not found"),
    });

    const rows = await built.sink.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "error", resultSummary: "not-found: Document not found" });
  });

  it("does not fail the primary operation when the real sink write throws (e.g. table missing)", async () => {
    const db2 = knexLib({ client: "better-sqlite3", connection: ":memory:", useNullAsDefault: true });
    db = db2;
    // No audit_logs table created — every insert will genuinely fail against the real database.
    const app = mantle();
    app.set("knex", db2);
    const sink = new SqliteAuditRepository(app);

    await expect(
      auditLog({ sink })({
        app,
        service: {},
        path: "documents",
        method: "find",
        params: { provider: "rest", headers: {} },
        result: [],
      }),
    ).resolves.toBeDefined();
  });
});
