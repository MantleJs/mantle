import { afterAll, beforeAll, describe, expect, it } from "vitest";
import knexLib from "knex";
import type { Knex } from "knex";
import type { Id, MantleApplication, QueryParams } from "@mantlejs/mantle";
import { Forbidden, NotFound, mantle } from "@mantlejs/mantle";
import { KnexRepository } from "./knex-repository.js";

/**
 * Postgres row-level security as defense in depth for multi-tenancy (Phase 8 spike 4, Decision #7).
 * Needs a real server: set MANTLE_PG_URL to a superuser connection string, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16-alpine
 *   MANTLE_PG_URL=postgres://postgres:pg@127.0.0.1:55432/postgres npx nx test knex
 * Skipped otherwise.
 *
 * The recipe under test: the app connects as a role that does NOT own the table (owners and superusers
 * bypass RLS unless FORCE ROW LEVEL SECURITY is set), and every repository call runs inside a transaction
 * that first calls `set_config('app.tenant_id', $1, true)` — transaction-local, so the setting can't leak to
 * the next request that checks out the same pooled connection. (`SET LOCAL` itself can't take bind
 * parameters; `set_config()` can.) `Repository<T>` methods never see `params`, so the tenant is passed in
 * explicitly via `forTenant()`.
 */
const PG_URL = process.env["MANTLE_PG_URL"];
const APP_ROLE = "mantle_rls_app";
const APP_PASSWORD = "mantle_rls_app";

interface Doc extends Record<string, unknown> {
  id: string;
  tenantId: string;
  title: string;
}

class TenantDocRepository extends KnexRepository<Doc> {
  readonly tableName = "rls_docs";
  override readonly timestamps = false;
  override readonly columnCase = "snake_case";
  protected tenantId?: string;

  /** A copy of this repository whose every call runs with RLS scoped to `tenantId`. */
  forTenant(tenantId: string): this {
    const copy = Object.create(this) as this;
    copy.tenantId = tenantId;
    return copy;
  }

  private async scoped<R>(run: (repo: this) => Promise<R>): Promise<R> {
    if (this.tenantId === undefined) throw new Forbidden("No tenant in scope");
    const tenantId = this.tenantId;
    const setTenant = (trx: Knex.Transaction) => trx.raw("select set_config('app.tenant_id', ?, true)", [tenantId]);
    if (this._trx) {
      await setTenant(this._trx);
      return run(this);
    }
    return this.withTransaction(async (tx) => {
      await setTenant(tx._trx as Knex.Transaction);
      return run(tx);
    });
  }

  override findAll(params?: QueryParams): Promise<Doc[]> {
    return this.scoped((repo) => super.findAll.call(repo, params));
  }
  override findById(id: Id): Promise<Doc | null> {
    return this.scoped((repo) => super.findById.call(repo, id));
  }
  override save(data: Partial<Doc>): Promise<Doc> {
    return this.scoped((repo) => super.save.call(repo, data));
  }
  override patchById(id: Id, data: Partial<Doc>): Promise<Doc> {
    return this.scoped((repo) => super.patchById.call(repo, id, data));
  }
  override deleteById(id: Id): Promise<Doc> {
    return this.scoped((repo) => super.deleteById.call(repo, id));
  }
  override count(params?: QueryParams): Promise<number> {
    return this.scoped((repo) => super.count.call(repo, params));
  }
}

describe.skipIf(!PG_URL)("KnexRepository on Postgres — row-level security recipe (spike 4)", () => {
  let admin: Knex;
  let db: Knex;
  let app: MantleApplication;

  beforeAll(async () => {
    admin = knexLib({ client: "pg", connection: PG_URL });
    await admin.raw(`
      drop table if exists rls_docs;
      drop role if exists ${APP_ROLE};
      create role ${APP_ROLE} login password '${APP_PASSWORD}';
      create table rls_docs (id text primary key, tenant_id text not null, title text);
      alter table rls_docs enable row level security;
      create policy tenant_isolation on rls_docs
        using (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
      grant select, insert, update, delete on rls_docs to ${APP_ROLE};
      insert into rls_docs values ('a1', 'A', 'A doc'), ('b1', 'B', 'B doc');
    `);
    const url = new URL(PG_URL as string);
    url.username = APP_ROLE;
    url.password = APP_PASSWORD;
    // A single pooled connection: every call reuses the same session, so any leak would show.
    db = knexLib({ client: "pg", connection: url.toString(), pool: { min: 1, max: 1 } });
    app = mantle().set("knex", db);
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.raw(`drop table if exists rls_docs; drop role if exists ${APP_ROLE};`);
    await admin?.destroy();
  });

  it("scopes reads to the tenant", async () => {
    const repo = new TenantDocRepository(app);
    await expect(repo.forTenant("A").findAll()).resolves.toEqual([{ id: "a1", tenantId: "A", title: "A doc" }]);
    await expect(repo.forTenant("B").count()).resolves.toBe(1);
  });

  it("fails closed when no tenant is set on the connection", async () => {
    await expect(db("rls_docs").select("id")).resolves.toEqual([]);
  });

  it("doesn't leak the tenant to the next call on the same pooled connection", async () => {
    await new TenantDocRepository(app).forTenant("A").findAll();
    await expect(db("rls_docs").select("id")).resolves.toEqual([]);
  });

  it("hides another tenant's row by id, so writes to it are NotFound", async () => {
    const repo = new TenantDocRepository(app).forTenant("A");
    await expect(repo.findById("b1")).resolves.toBeNull();
    await expect(repo.patchById("b1", { title: "pwned" })).rejects.toBeInstanceOf(NotFound);
    await expect(repo.deleteById("b1")).rejects.toBeInstanceOf(NotFound);
  });

  it("rejects creating a row for another tenant with Forbidden (WITH CHECK, SQLSTATE 42501)", async () => {
    const repo = new TenantDocRepository(app).forTenant("A");
    await expect(repo.save({ id: "x1", tenantId: "B", title: "cross" })).rejects.toBeInstanceOf(Forbidden);
  });

  it("rejects moving a row to another tenant with Forbidden", async () => {
    const repo = new TenantDocRepository(app).forTenant("A");
    await expect(repo.patchById("a1", { tenantId: "B" })).rejects.toBeInstanceOf(Forbidden);
  });

  it("keeps the scope across calls inside one withTransaction()", async () => {
    const repo = new TenantDocRepository(app).forTenant("A");
    const titles = await repo.withTransaction(async (tx) => {
      await tx.save({ id: "a2", tenantId: "A", title: "second" });
      return (await tx.findAll()).map((doc) => doc.title).sort();
    });
    expect(titles).toEqual(["A doc", "second"]);
    await repo.deleteById("a2");
  });

  it("keeps concurrent tenants isolated across a shared pool", async () => {
    const url = new URL(PG_URL as string);
    url.username = APP_ROLE;
    url.password = APP_PASSWORD;
    const pooled = knexLib({ client: "pg", connection: url.toString(), pool: { min: 2, max: 2 } });
    try {
      const repo = new TenantDocRepository(mantle().set("knex", pooled));
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? "A" : "B")).map(async (tenant) => ({
          tenant,
          ids: (await repo.forTenant(tenant).findAll()).map((doc) => doc.tenantId),
        })),
      );
      for (const { tenant, ids } of results) expect(ids).toEqual([tenant]);
    } finally {
      await pooled.destroy();
    }
  });

  it("is bypassed by a superuser — why the app must connect as its own non-owner role", async () => {
    // Table owners bypass it too, unless the table sets FORCE ROW LEVEL SECURITY (verified in the spike probe).
    await expect(admin("rls_docs").count({ n: "*" })).resolves.toEqual([{ n: "2" }]);
  });
});
