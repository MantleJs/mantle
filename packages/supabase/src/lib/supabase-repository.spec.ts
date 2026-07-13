import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseRepository } from "./supabase-repository.js";
import { NotFound, Conflict, BadRequest, Forbidden, GeneralError } from "@mantlejs/mantle";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TestRow {
  id: string;
  name: string;
  email: string;
  created_at?: string;
  updated_at?: string;
}

/** Builds a chainable PostgREST mock that resolves to `result` at the end of the chain. */
function makeQuery(result: { data?: unknown; error?: unknown; count?: number | null } = {}) {
  const chain: Record<string, unknown> = {};
  const terminal = () =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null });
  const methods = [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "lt",
    "lte",
    "gt",
    "gte",
    "is",
    "in",
    "not",
    "like",
    "ilike",
    "or",
    "order",
    "range",
    "maybeSingle",
    "single",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // Override terminal methods
  (chain["maybeSingle"] as ReturnType<typeof vi.fn>).mockImplementation(terminal);
  (chain["single"] as ReturnType<typeof vi.fn>).mockImplementation(terminal);
  // Make the chain itself then-able so await works without calling a terminal method
  (chain as unknown as Promise<unknown>).then = (onfulfilled: unknown, onrejected: unknown) =>
    terminal().then(onfulfilled as never, onrejected as never);
  return chain;
}

// ─── Concrete test repository ─────────────────────────────────────────────────

class UserRepository extends SupabaseRepository<TestRow> {
  readonly tableName = "users";
  readonly timestamps = false; // disable for simpler assertions
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SupabaseRepository", () => {
  let fromMock: ReturnType<typeof vi.fn>;
  let repo: UserRepository;

  beforeEach(() => {
    fromMock = vi.fn();
    const mockApp = {
      get: () => ({ from: fromMock }),
    };
    repo = new UserRepository(mockApp as never);
    vi.clearAllMocks();
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe("findAll", () => {
    it("returns all rows", async () => {
      const rows: TestRow[] = [{ id: "1", name: "Alice", email: "alice@test.com" }];
      fromMock.mockReturnValue(makeQuery({ data: rows }));
      const result = await repo.findAll();
      expect(result).toEqual(rows);
    });

    it("returns empty array when no rows", async () => {
      fromMock.mockReturnValue(makeQuery({ data: null }));
      const result = await repo.findAll();
      expect(result).toEqual([]);
    });

    it("throws GeneralError on Supabase error", async () => {
      fromMock.mockReturnValue(makeQuery({ error: { message: "connection failed" } }));
      await expect(repo.findAll()).rejects.toBeInstanceOf(GeneralError);
    });
  });

  // ── $or filter escaping ─────────────────────────────────────────────────────

  describe("$or filter building", () => {
    it("quotes string values so a comma cannot split the filter", async () => {
      const chain = makeQuery({ data: [] });
      fromMock.mockReturnValue(chain);
      await repo.findAll({ where: { $or: [{ name: "a,b" }, { name: "c" }] } });
      expect(chain["or"]).toHaveBeenCalledWith('name.eq."a,b",name.eq."c"');
    });

    it("escapes embedded quotes and parentheses safely", async () => {
      const chain = makeQuery({ data: [] });
      fromMock.mockReturnValue(chain);
      await repo.findAll({ where: { $or: [{ name: 'x")(evil' }] } });
      expect(chain["or"]).toHaveBeenCalledWith('name.eq."x\\")(evil"');
    });

    it("leaves numbers and booleans unquoted", async () => {
      const chain = makeQuery({ data: [] });
      fromMock.mockReturnValue(chain);
      await repo.findAll({ where: { $or: [{ age: { $gt: 21 } }, { active: true }] } });
      expect(chain["or"]).toHaveBeenCalledWith('age.gt.21,active.eq.true');
    });

    it("builds quoted parenthesized lists for $in inside $or", async () => {
      const chain = makeQuery({ data: [] });
      fromMock.mockReturnValue(chain);
      await repo.findAll({ where: { $or: [{ role: { $in: ["a,b", "c"] } }] } });
      expect(chain["or"]).toHaveBeenCalledWith('role.in.("a,b","c")');
    });

    it("throws BadRequest for an unknown operator inside $or", async () => {
      const chain = makeQuery({ data: [] });
      fromMock.mockReturnValue(chain);
      await expect(repo.findAll({ where: { $or: [{ age: { $get: 21 } }] } })).rejects.toBeInstanceOf(BadRequest);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns a row by primary key", async () => {
      const row: TestRow = { id: "1", name: "Alice", email: "alice@test.com" };
      fromMock.mockReturnValue(makeQuery({ data: row }));
      const result = await repo.findById("1");
      expect(result).toEqual(row);
    });

    it("returns null when not found", async () => {
      fromMock.mockReturnValue(makeQuery({ data: null }));
      const result = await repo.findById("999");
      expect(result).toBeNull();
    });
  });

  // ── save ───────────────────────────────────────────────────────────────────

  describe("save", () => {
    it("inserts and returns the created row", async () => {
      const row: TestRow = { id: "1", name: "Alice", email: "alice@test.com" };
      fromMock.mockReturnValue(makeQuery({ data: row }));
      const result = await repo.save({ name: "Alice", email: "alice@test.com" });
      expect(result).toEqual(row);
    });

    it("throws Conflict on unique violation (code 23505)", async () => {
      fromMock.mockReturnValue(makeQuery({ error: { code: "23505", message: "duplicate key" } }));
      await expect(repo.save({ name: "Alice", email: "alice@test.com" })).rejects.toBeInstanceOf(Conflict);
    });
  });

  // ── saveAll ────────────────────────────────────────────────────────────────

  describe("saveAll", () => {
    it("inserts multiple rows and returns them", async () => {
      const rows: TestRow[] = [
        { id: "1", name: "Alice", email: "alice@test.com" },
        { id: "2", name: "Bob", email: "bob@test.com" },
      ];
      fromMock.mockReturnValue(makeQuery({ data: rows }));
      const result = await repo.saveAll([
        { name: "Alice", email: "alice@test.com" },
        { name: "Bob", email: "bob@test.com" },
      ]);
      expect(result).toEqual(rows);
    });
  });

  // ── updateById ─────────────────────────────────────────────────────────────

  describe("updateById", () => {
    it("updates and returns the updated row", async () => {
      const existing: TestRow = { id: "1", name: "Alice", email: "alice@test.com" };
      const updated: TestRow = { id: "1", name: "Alice Updated", email: "alice@test.com" };
      // first call: findById (maybeSingle), second call: update (single)
      fromMock.mockReturnValueOnce(makeQuery({ data: existing })).mockReturnValueOnce(makeQuery({ data: updated }));
      const result = await repo.updateById("1", { name: "Alice Updated", email: "alice@test.com" });
      expect(result).toEqual(updated);
    });

    it("throws NotFound when the row does not exist", async () => {
      fromMock.mockReturnValue(makeQuery({ data: null }));
      await expect(repo.updateById("999", { name: "Ghost", email: "ghost@test.com" })).rejects.toBeInstanceOf(NotFound);
    });
  });

  // ── patchById ──────────────────────────────────────────────────────────────

  describe("patchById", () => {
    it("patches and returns the updated row", async () => {
      const updated: TestRow = { id: "1", name: "Alice Patched", email: "alice@test.com" };
      fromMock.mockReturnValue(makeQuery({ data: updated }));
      const result = await repo.patchById("1", { name: "Alice Patched" });
      expect(result).toEqual(updated);
    });

    it("throws NotFound on PGRST116 (row not found)", async () => {
      fromMock.mockReturnValue(makeQuery({ error: { code: "PGRST116", message: "no rows" } }));
      await expect(repo.patchById("999", { name: "Ghost" })).rejects.toBeInstanceOf(NotFound);
    });
  });

  // ── deleteById ─────────────────────────────────────────────────────────────

  describe("deleteById", () => {
    it("deletes and returns the deleted row", async () => {
      const row: TestRow = { id: "1", name: "Alice", email: "alice@test.com" };
      fromMock.mockReturnValue(makeQuery({ data: row }));
      const result = await repo.deleteById("1");
      expect(result).toEqual(row);
    });

    it("throws NotFound on PGRST116", async () => {
      fromMock.mockReturnValue(makeQuery({ error: { code: "PGRST116", message: "no rows" } }));
      await expect(repo.deleteById("999")).rejects.toBeInstanceOf(NotFound);
    });
  });

  // ── count ──────────────────────────────────────────────────────────────────

  describe("count", () => {
    it("returns the row count", async () => {
      fromMock.mockReturnValue(makeQuery({ count: 42 }));
      const result = await repo.count();
      expect(result).toBe(42);
    });

    it("returns 0 when count is null", async () => {
      fromMock.mockReturnValue(makeQuery({ count: null }));
      const result = await repo.count();
      expect(result).toBe(0);
    });
  });

  // ── filter operators ───────────────────────────────────────────────────────

  describe("applyParams / filter operators", () => {
    it("applies $or filter", async () => {
      const rows: TestRow[] = [{ id: "1", name: "Alice", email: "alice@test.com" }];
      const q = makeQuery({ data: rows });
      fromMock.mockReturnValue(q);
      await repo.findAll({ where: { $or: [{ name: "Alice" }, { name: "Bob" }] } });
      expect(q["or"]).toHaveBeenCalled();
    });

    it("applies $and filter by chaining eq calls", async () => {
      const rows: TestRow[] = [{ id: "1", name: "Alice", email: "alice@test.com" }];
      const q = makeQuery({ data: rows });
      fromMock.mockReturnValue(q);
      await repo.findAll({ where: { $and: [{ name: "Alice" }, { email: "alice@test.com" }] } });
      expect(q["eq"]).toHaveBeenCalled();
    });

    it("applies $in operator", async () => {
      const rows: TestRow[] = [{ id: "1", name: "Alice", email: "alice@test.com" }];
      const q = makeQuery({ data: rows });
      fromMock.mockReturnValue(q);
      await repo.findAll({ where: { name: { $in: ["Alice", "Bob"] } } });
      expect(q["in"]).toHaveBeenCalledWith("name", ["Alice", "Bob"]);
    });

    it("applies $ne with null (IS NOT NULL)", async () => {
      const rows: TestRow[] = [{ id: "1", name: "Alice", email: "alice@test.com" }];
      const q = makeQuery({ data: rows });
      fromMock.mockReturnValue(q);
      await repo.findAll({ where: { name: { $ne: null } } });
      expect(q["not"]).toHaveBeenCalledWith("name", "is", null);
    });

    it("applies sort and limit", async () => {
      const q = makeQuery({ data: [] });
      fromMock.mockReturnValue(q);
      await repo.findAll({ sort: { name: "asc" }, limit: 10, skip: 5 });
      expect(q["order"]).toHaveBeenCalledWith("name", { ascending: true });
      expect(q["range"]).toHaveBeenCalledWith(5, 14);
    });

    it("throws BadRequest on unsupported operator", async () => {
      fromMock.mockReturnValue(makeQuery({ data: [] }));
      await expect(repo.findAll({ where: { name: { $unknown: "x" } } })).rejects.toBeInstanceOf(BadRequest);
    });
  });

  // ── listenToChanges ────────────────────────────────────────────────────────

  describe("listenToChanges", () => {
    it("subscribes to Postgres Changes on construction when listenToChanges=true", async () => {
      const channelMock = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };
      const removeChannelMock = vi.fn().mockResolvedValue(undefined);
      const emitMock = vi.fn();
      const mockSupabaseClient = {
        from: fromMock,
        channel: vi.fn(() => channelMock),
        removeChannel: removeChannelMock,
      };
      const mockApp = {
        get: () => mockSupabaseClient,
        emit: emitMock,
        teardown: vi.fn().mockResolvedValue(undefined),
      };

      class ListeningRepo extends SupabaseRepository<TestRow> {
        readonly tableName = "posts";
        readonly listenToChanges = true;
      }

      new ListeningRepo(mockApp as never);
      await Promise.resolve(); // flush queueMicrotask

      expect(mockSupabaseClient.channel).toHaveBeenCalledWith("mantle:changes:posts");
      expect(channelMock.on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "posts" }, expect.any(Function));
      expect(channelMock.subscribe).toHaveBeenCalled();
    });

    it("emits service:event created on INSERT", async () => {
      let changeHandler: ((payload: unknown) => void) | null = null;
      const channelMock = {
        on: vi.fn((event: string, filter: unknown, handler: (payload: unknown) => void) => {
          if (event === "postgres_changes") changeHandler = handler;
          return channelMock;
        }),
        subscribe: vi.fn().mockReturnThis(),
      };
      const emitMock = vi.fn();
      const mockApp = {
        get: () => ({ from: fromMock, channel: vi.fn(() => channelMock), removeChannel: vi.fn() }),
        emit: emitMock,
        teardown: vi.fn().mockResolvedValue(undefined),
      };

      class ListeningRepo extends SupabaseRepository<TestRow> {
        readonly tableName = "posts";
        readonly listenToChanges = true;
      }

      new ListeningRepo(mockApp as never);
      await Promise.resolve(); // flush queueMicrotask

      const row = { id: "1", name: "Alice", email: "alice@test.com" };
      if (!changeHandler) throw new Error("changeHandler not captured");
      changeHandler({ eventType: "INSERT", new: row, old: {} });
      expect(emitMock).toHaveBeenCalledWith("service:event", "posts", "created", row, {});
    });

    it("emits service:event patched on UPDATE", async () => {
      let changeHandler: ((payload: unknown) => void) | null = null;
      const channelMock = {
        on: vi.fn((event: string, filter: unknown, handler: (payload: unknown) => void) => {
          if (event === "postgres_changes") changeHandler = handler;
          return channelMock;
        }),
        subscribe: vi.fn().mockReturnThis(),
      };
      const emitMock = vi.fn();
      const mockApp = {
        get: () => ({ from: fromMock, channel: vi.fn(() => channelMock), removeChannel: vi.fn() }),
        emit: emitMock,
        teardown: vi.fn().mockResolvedValue(undefined),
      };

      class ListeningRepo extends SupabaseRepository<TestRow> {
        readonly tableName = "posts";
        readonly listenToChanges = true;
      }

      new ListeningRepo(mockApp as never);
      await Promise.resolve(); // flush queueMicrotask

      const row = { id: "1", name: "Updated", email: "alice@test.com" };
      if (!changeHandler) throw new Error("changeHandler not captured");
      changeHandler({ eventType: "UPDATE", new: row, old: { id: "1" } });
      expect(emitMock).toHaveBeenCalledWith("service:event", "posts", "patched", row, {});
    });

    it("emits service:event removed on DELETE", async () => {
      let changeHandler: ((payload: unknown) => void) | null = null;
      const channelMock = {
        on: vi.fn((event: string, filter: unknown, handler: (payload: unknown) => void) => {
          if (event === "postgres_changes") changeHandler = handler;
          return channelMock;
        }),
        subscribe: vi.fn().mockReturnThis(),
      };
      const emitMock = vi.fn();
      const mockApp = {
        get: () => ({ from: fromMock, channel: vi.fn(() => channelMock), removeChannel: vi.fn() }),
        emit: emitMock,
        teardown: vi.fn().mockResolvedValue(undefined),
      };

      class ListeningRepo extends SupabaseRepository<TestRow> {
        readonly tableName = "posts";
        readonly listenToChanges = true;
      }

      new ListeningRepo(mockApp as never);
      await Promise.resolve(); // flush queueMicrotask

      const row = { id: "1", name: "Alice", email: "alice@test.com" };
      if (!changeHandler) throw new Error("changeHandler not captured");
      changeHandler({ eventType: "DELETE", new: {}, old: row });
      expect(emitMock).toHaveBeenCalledWith("service:event", "posts", "removed", row, {});
    });

    it("does not subscribe when listenToChanges=false (default)", async () => {
      const channelMock = vi.fn();
      const mockApp = {
        get: () => ({ from: fromMock, channel: channelMock }),
        emit: vi.fn(),
      };
      new UserRepository(mockApp as never);
      await Promise.resolve(); // flush queueMicrotask
      expect(channelMock).not.toHaveBeenCalled();
    });
  });

  // ── wrapError ─────────────────────────────────────────────────────────────

  describe("wrapError", () => {
    it("maps PGRST116 to NotFound", () => {
      // Access protected method via cast
      const err = (repo as unknown as { wrapError: (e: unknown) => Error }).wrapError({
        code: "PGRST116",
        message: "not found",
      });
      expect(err).toBeInstanceOf(NotFound);
    });

    it("maps 23505 to Conflict", () => {
      const err = (repo as unknown as { wrapError: (e: unknown) => Error }).wrapError({
        code: "23505",
        message: "dup",
      });
      expect(err).toBeInstanceOf(Conflict);
    });

    it("maps 23503 to BadRequest", () => {
      const err = (repo as unknown as { wrapError: (e: unknown) => Error }).wrapError({ code: "23503", message: "fk" });
      expect(err).toBeInstanceOf(BadRequest);
    });

    it("maps 42501 to Forbidden", () => {
      const err = (repo as unknown as { wrapError: (e: unknown) => Error }).wrapError({
        code: "42501",
        message: "forbidden",
      });
      expect(err).toBeInstanceOf(Forbidden);
    });

    it("maps unknown codes to GeneralError", () => {
      const err = (repo as unknown as { wrapError: (e: unknown) => Error }).wrapError({
        code: "99999",
        message: "unknown",
      });
      expect(err).toBeInstanceOf(GeneralError);
    });
  });
});
