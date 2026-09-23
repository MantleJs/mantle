import { describe, expect, it, vi } from "vitest";
import type { HookContext } from "@mantlejs/mantle";
import { BadRequest, NotFound } from "@mantlejs/mantle";
import { MemoryRepository } from "@mantlejs/memory";
import { auditLog } from "./audit.js";
import type { AuditRecord } from "./audit.js";

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    app: { get: vi.fn() } as unknown as HookContext["app"],
    service: {},
    path: "documents",
    method: "find",
    params: { provider: "rest", headers: { authorization: "Bearer secret-token" } },
    ...overrides,
  } as HookContext;
}

describe("auditLog()", () => {
  it("records an entry for a plain (non-agent) user call", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const ctx = makeCtx({
      method: "find",
      params: { provider: "rest", headers: {}, user: { sub: "user-1" }, query: { where: { done: false } } },
      result: [{ id: "1" }, { id: "2" }],
    });

    await auditLog({ sink })(ctx);

    const [record] = await sink.findAll();
    expect(record).toMatchObject({
      principal: { sub: "user-1" },
      path: "documents",
      method: "find",
      params: { where: { done: false } },
      status: "success",
      resultSummary: "2 record(s)",
    });
    expect(record?.agentId).toBeUndefined();
    expect(typeof record?.timestamp).toBe("string");
  });

  it("records an entry for an agent-originated call, with scope and delegating user", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const ctx = makeCtx({
      method: "get",
      id: "doc-1",
      params: { provider: "rest", headers: {} },
      agent: { id: "agent-1", scope: { documents: ["get"] }, delegatingUserId: "user-1" },
      result: { id: "doc-1", title: "Hello" },
    });

    await auditLog({ sink })(ctx);

    const [record] = await sink.findAll();
    expect(record).toMatchObject({
      agentId: "agent-1",
      agentScope: { documents: ["get"] },
      delegatingUserId: "user-1",
      path: "documents",
      method: "get",
      status: "success",
      resultSummary: "record id=doc-1",
    });
  });

  it("never stores headers or the raw params object — only params.query", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const ctx = makeCtx({
      params: {
        provider: "rest",
        headers: { authorization: "Bearer secret-token" },
        user: { sub: "user-1", passwordHash: "should-not-leak-here-either" },
      },
      result: [],
    });

    await auditLog({ sink })(ctx);

    const [record] = await sink.findAll();
    expect(JSON.stringify(record)).not.toContain("secret-token");
    expect(record?.params).toBeUndefined();
  });

  it("summarizes a paginated result", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const ctx = makeCtx({ result: { data: [{ id: "1" }], total: 10, limit: 1, skip: 0 } });

    await auditLog({ sink })(ctx);

    const [record] = await sink.findAll();
    expect(record?.resultSummary).toBe("1 of 10 record(s)");
  });

  it("records status 'error' with a resultSummary built from the thrown MantleError", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const ctx = makeCtx({ method: "get", error: new NotFound("Document not found") });

    await auditLog({ sink })(ctx);

    const [record] = await sink.findAll();
    expect(record).toMatchObject({ status: "error", resultSummary: "not-found: Document not found" });
  });

  it("returns the context unchanged (and does not throw) on success", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const ctx = makeCtx({ result: [] });

    const result = await auditLog({ sink })(ctx);

    expect(result).toBe(ctx);
  });

  it("does not fail the primary operation when the sink write throws", async () => {
    const sink = { save: vi.fn().mockRejectedValue(new Error("sink is down")) } as unknown as MemoryRepository<AuditRecord>;
    const ctx = makeCtx({ error: new BadRequest("bad input") });

    await expect(auditLog({ sink })(ctx)).resolves.toBe(ctx);
  });

  it("calls onSinkError with the failure instead of throwing", async () => {
    const failure = new Error("sink is down");
    const sink = { save: vi.fn().mockRejectedValue(failure) } as unknown as MemoryRepository<AuditRecord>;
    const onSinkError = vi.fn();
    const ctx = makeCtx({ result: [] });

    await auditLog({ sink, onSinkError })(ctx);

    expect(onSinkError).toHaveBeenCalledWith(failure, expect.objectContaining({ path: "documents" }), ctx);
  });

  it("falls back to app.get('logger') when no onSinkError is given and a logger is configured", async () => {
    const failure = new Error("sink is down");
    const sink = { save: vi.fn().mockRejectedValue(failure) } as unknown as MemoryRepository<AuditRecord>;
    const logError = vi.fn();
    const ctx = makeCtx({ result: [] });
    (ctx.app.get as ReturnType<typeof vi.fn>).mockReturnValue({ error: logError });

    await auditLog({ sink })(ctx);

    expect(logError).toHaveBeenCalledWith("Audit sink write failed", expect.objectContaining({ path: "documents" }));
  });

  it("is silent (no throw) when the sink fails, no onSinkError is given, and no logger is configured", async () => {
    const sink = { save: vi.fn().mockRejectedValue(new Error("sink is down")) } as unknown as MemoryRepository<AuditRecord>;
    const ctx = makeCtx({ result: [] });
    (ctx.app.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await expect(auditLog({ sink })(ctx)).resolves.toBe(ctx);
  });
});
