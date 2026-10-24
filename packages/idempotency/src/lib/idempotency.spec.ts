import { afterEach, beforeEach, describe, expect, it } from "vitest";
import knexLib from "knex";
import type { Knex } from "knex";
import type { HttpResponseMeta, MantleApplication, ServiceParams } from "@mantlejs/mantle";
import { BadRequest, Conflict, GeneralError, mantle, Unprocessable } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { KnexRepository } from "@mantlejs/knex";
import { MemoryRepository } from "@mantlejs/memory";
import { idempotency, type IdempotencyOptions, type IdempotencyRecord } from "./idempotency.js";

interface Payment extends Record<string, unknown> {
  id: string;
  amount: number;
}

/** A payments service whose create counts its calls, and can be made slow or failing per call. */
function setup(options: Partial<IdempotencyOptions> = {}) {
  const store = new MemoryRepository<IdempotencyRecord>({ timestamps: false });
  const calls = { create: 0, patch: 0 };
  const control = { delayMs: 0, fail: false };
  const app = mantle();
  app.use<Payment>("payments", {
    async create(data) {
      calls.create++;
      if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
      if (control.fail) throw new GeneralError("card declined");
      return { id: `p${calls.create}`, amount: Number(data.amount) };
    },
    async patch(id, data) {
      calls.patch++;
      return { id: String(id), amount: Number(data.amount) };
    },
    async find() {
      return [];
    },
  });
  const guard = idempotency({ store, ...options });
  app.service("payments").hooks({
    before: { all: [guard.before] },
    after: { all: [guard.after] },
    error: { all: [guard.error] },
  });
  const events: unknown[] = [];
  app.on("service:event", (...args) => events.push(args));

  const call = async (method: "create" | "patch" | "find", params: ServiceParams = {}, data?: Partial<Payment>) => {
    const response: HttpResponseMeta = {};
    const result = await app
      .service<Payment>("payments")
      .dispatch(method, data, method === "patch" ? "p1" : undefined, { provider: "rest", ...params }, { response });
    return { result, response };
  };
  const keyed = (key: string, extra: ServiceParams = {}) => ({ headers: { "idempotency-key": key }, ...extra });
  return { app, store, calls, control, events, call, keyed };
}

describe("idempotency() — keys", () => {
  it("passes a call without a key straight through", async () => {
    const { call, calls, store } = setup();
    await call("create", {}, { amount: 5 });
    await call("create", {}, { amount: 5 });
    expect(calls.create).toBe(2);
    await expect(store.count()).resolves.toBe(0);
  });

  it("with required, rejects a call without a key with BadRequest and a hint", async () => {
    const { call, calls } = setup({ required: true });
    const error = await call("create", {}, { amount: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequest);
    expect((error as BadRequest).hint).toMatch(/Idempotency-Key/);
    expect(calls.create).toBe(0);
  });

  it.each(["", "has space", "a".repeat(256), "ünï"])("rejects the malformed key %j", async (key) => {
    const { call } = setup();
    await expect(call("create", { headers: { "idempotency-key": key } }, { amount: 5 })).rejects.toBeInstanceOf(
      BadRequest,
    );
  });

  it("reads params.idempotencyKey (internal calls, MCP, the client SDK)", async () => {
    const { call, calls } = setup();
    await call("create", { idempotencyKey: "k1" }, { amount: 5 });
    await call("create", { idempotencyKey: "k1" }, { amount: 5 });
    expect(calls.create).toBe(1);
  });

  it("leaves other methods alone, so registering on `all` is safe", async () => {
    const { call, store } = setup({ required: true });
    await expect(call("find")).resolves.toBeDefined();
    await expect(store.count()).resolves.toBe(0);
  });
});

describe("idempotency() — replay", () => {
  it("runs the first call once, then replays its result with Idempotent-Replayed and no second event", async () => {
    const { call, calls, events } = setup();
    const first = await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    const second = await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    expect(calls.create).toBe(1);
    expect(second.result).toEqual(first.result);
    expect(first.response.headers?.["Idempotent-Replayed"]).toBeUndefined();
    expect(second.response.headers?.["Idempotent-Replayed"]).toBe("true");
    expect(events).toHaveLength(1);
  });

  it("stores the completed result with its fingerprint and expiry", async () => {
    const { call, store } = setup({ ttlSeconds: 60 });
    await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    const [record] = await store.findAll();
    expect(record).toMatchObject({ status: "completed", response: JSON.stringify({ id: "p1", amount: 5 }) });
    expect(record?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(record?.expiresAt ?? "") - Date.now()).toBeGreaterThan(55_000);
  });

  it("replays patch too", async () => {
    const { call, calls } = setup();
    await call("patch", { headers: { "idempotency-key": "k1" } }, { amount: 7 });
    const second = await call("patch", { headers: { "idempotency-key": "k1" } }, { amount: 7 });
    expect(calls.patch).toBe(1);
    expect(second.response.headers?.["Idempotent-Replayed"]).toBe("true");
  });

  it("treats key order in the data as the same request", async () => {
    const { call, calls } = setup();
    await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5, id: "x" });
    await call("create", { headers: { "idempotency-key": "k1" } }, { id: "x", amount: 5 });
    expect(calls.create).toBe(1);
  });

  it("rejects the same key with a different request as Unprocessable", async () => {
    const { call, calls } = setup();
    await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    await expect(call("create", { headers: { "idempotency-key": "k1" } }, { amount: 6 })).rejects.toBeInstanceOf(
      Unprocessable,
    );
    expect(calls.create).toBe(1);
  });

  it("reuses a key once its record has expired", async () => {
    const { call, calls, store } = setup();
    await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    const [record] = await store.findAll();
    await store.patchById(record?.id as string, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    expect(calls.create).toBe(2);
  });
});

describe("idempotency() — scope", () => {
  it("never replays one user's key for another user", async () => {
    const { call, calls } = setup();
    await call("create", { headers: { "idempotency-key": "k1" }, user: { id: "alice" } }, { amount: 5 });
    await call("create", { headers: { "idempotency-key": "k1" }, user: { id: "bob" } }, { amount: 5 });
    expect(calls.create).toBe(2);
  });

  it("scopes by service method: the same key on create and patch are separate", async () => {
    const { call, calls } = setup();
    await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    await call("patch", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    expect(calls).toEqual({ create: 1, patch: 1 });
  });

  it('uses 24-character ObjectId-shaped record ids with idFormat: "objectid" (MongoDB)', async () => {
    const { call, store } = setup({ idFormat: "objectid" });
    await call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 });
    const [record] = await store.findAll();
    expect(record?.id).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("idempotency() — failures and concurrency", () => {
  it("doesn't cache errors: the key is released and a retry runs again", async () => {
    const { call, calls, control, store } = setup();
    control.fail = true;
    await expect(call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 })).rejects.toThrow("declined");
    await expect(store.count()).resolves.toBe(0);
    control.fail = false;
    await expect(call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 })).resolves.toBeDefined();
    expect(calls.create).toBe(2);
  });

  it("of two concurrent calls with one key, runs exactly one; the other gets Conflict", async () => {
    const { call, calls, control } = setup();
    control.delayMs = 30;
    const outcomes = await Promise.allSettled([
      call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 }),
      call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 }),
    ]);
    expect(calls.create).toBe(1);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const [rejected] = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(Conflict);
    expect((rejected?.reason as Conflict).hint).toMatch(/same Idempotency-Key/);
  });

  it("returns the result and releases the key when storing it fails", async () => {
    const { call, store } = setup();
    const patchById = store.patchById.bind(store);
    store.patchById = async () => {
      throw new GeneralError("store down");
    };
    await expect(call("create", { headers: { "idempotency-key": "k1" } }, { amount: 5 })).resolves.toMatchObject({
      result: { id: "p1" },
    });
    store.patchById = patchById;
    await expect(store.count()).resolves.toBe(0);
  });

  it("rejects an invalid ttlSeconds when created", () => {
    expect(() => idempotency({ store: new MemoryRepository<IdempotencyRecord>(), ttlSeconds: 0 })).toThrow(BadRequest);
  });
});

describe("over HTTP (@mantlejs/http)", () => {
  function httpApp(): {
    app: MantleApplication;
    calls: { n: number };
    fetch: (init: RequestInit) => Promise<Response>;
  } {
    const calls = { n: 0 };
    const app = mantle().configure(http());
    app.use(
      "payments",
      {
        async create(data: Record<string, unknown>) {
          calls.n++;
          return { id: `p${calls.n}`, ...data };
        },
      },
      { methods: ["create"] },
    );
    const guard = idempotency({ store: new MemoryRepository<IdempotencyRecord>({ timestamps: false }) });
    app.service("payments").hooks({
      before: { create: [guard.before] },
      after: { create: [guard.after] },
      error: { create: [guard.error] },
    });
    const fetchHandler = app.get<(request: Request) => Promise<Response>>("fetchHandler");
    return {
      app,
      calls,
      fetch: (init) => fetchHandler(new Request("http://localhost/payments", { method: "POST", ...init })),
    };
  }

  const json = (key: string, body: unknown): RequestInit => ({
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

  it("replays a retried POST with the original status and body, marked Idempotent-Replayed", async () => {
    const { fetch, calls } = httpApp();
    const first = await fetch(json("k1", { amount: 5 }));
    const second = await fetch(json("k1", { amount: 5 }));
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    expect(calls.n).toBe(1);
  });

  it("answers a reused key with a different body with 422 Problem Details", async () => {
    const { fetch } = httpApp();
    await fetch(json("k1", { amount: 5 }));
    const conflict = await fetch(json("k1", { amount: 6 }));
    expect(conflict.status).toBe(422);
    expect(await conflict.json()).toMatchObject({ type: "https://mantlejs.com/errors/unprocessable", status: 422 });
  });
});

describe("with a knex/SQLite store", () => {
  class IdempotencyRepository extends KnexRepository<IdempotencyRecord> {
    readonly tableName = "idempotency_keys";
    override readonly timestamps = false;
  }

  let db: Knex;
  let app: MantleApplication;

  beforeEach(async () => {
    db = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    await db.schema.createTable("idempotency_keys", (table) => {
      table.string("id").primary();
      table.string("fingerprint").notNullable();
      table.string("status").notNullable();
      table.text("response");
      table.string("expiresAt").notNullable();
    });
    app = mantle().set("knex", db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("reserves keys through the database's duplicate-id Conflict, and replays from the stored row", async () => {
    let created = 0;
    app.use(
      "payments",
      {
        async create(data: Record<string, unknown>) {
          created++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { id: `p${created}`, ...data };
        },
      },
      { methods: ["create"] },
    );
    const guard = idempotency({ store: new IdempotencyRepository(app) });
    app.service("payments").hooks({
      before: { create: [guard.before] },
      after: { create: [guard.after] },
      error: { create: [guard.error] },
    });
    const params = { provider: "rest", headers: { "idempotency-key": "k1" } };
    const payments = app.service("payments");

    const [a, b] = await Promise.allSettled([
      payments.create({ amount: 5 }, params),
      payments.create({ amount: 5 }, params),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(created).toBe(1);

    await expect(payments.create({ amount: 5 }, params)).resolves.toEqual({ id: "p1", amount: 5 });
    expect(created).toBe(1);
    const rows = await db("idempotency_keys").select("status");
    expect(rows).toEqual([{ status: "completed" }]);
  });
});
