import { NotFound } from "@mantlejs/mantle";
import type { CodeBridge, CodeExecutionResult, CodeLimits } from "./types.js";

/** A recorded bridged call, for cases asserting what reached the host. */
export interface BridgeCall {
  path: string;
  method: string;
  args: unknown[];
}

export interface ConformanceBridge extends CodeBridge {
  readonly log: BridgeCall[];
}

/** Host delay of `items.slow()`, in ms — the parallelism case asserts three run concurrently. */
const SLOW_MS = 100;

/**
 * The fixture bridge every conformance case runs against — one `items` service:
 * `get(id)` → `{ id }`; `find()` → two records after 10 ms; `slow()` → `"slow"` after 100 ms;
 * `fail()` → rejects `NotFound("Item missing", { id: "x" }, …, hint)`; `never()` → never settles.
 */
export function conformanceBridge(): ConformanceBridge {
  const log: BridgeCall[] = [];
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    log,
    services: { items: ["get", "find", "slow", "fail", "never"] },
    async call(path, method, args) {
      log.push({ path, method, args });
      switch (method) {
        case "get":
          return { id: args[0] };
        case "find":
          await sleep(10);
          return [{ id: 1 }, { id: 2 }];
        case "slow":
          await sleep(SLOW_MS);
          return "slow";
        case "fail":
          throw new NotFound("Item missing", { id: "x" }, undefined, "Check the id.");
        default:
          return new Promise<never>(() => undefined);
      }
    },
  };
}

export interface ConformanceCase {
  name: string;
  code: string;
  limits?: Partial<CodeLimits>;
  /** Run first on the same executor (its outcome is ignored) — for fresh-state and recovery cases. */
  before?: { code: string; limits?: Partial<CodeLimits> };
  /** Run this many executions concurrently; every one must meet `expect`. @default 1 */
  concurrency?: number;
  /** `errorName` may list several acceptable typed errors. */
  expect: { ok: true; value?: unknown } | { ok: false; errorName: string | string[] };
  /** Further checks — return a failure description, or `undefined` when the case passes. */
  check?: (result: CodeExecutionResult, bridge: ConformanceBridge, elapsedMs: number) => string | undefined;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Executor conformance suite (PRD spec 4) — data, not tests, so any `CodeExecutor` can run it
 * from its own spec runner (see `quickjs-executor.spec.ts` for the reference loop). Covers the
 * bridge contract, JSON-only values, error shapes, fresh state, concurrency, escape probes, and
 * every limit. Mirrors how `NESTED_QUERY_CASES` is shared across query adapters.
 */
export const CODE_EXECUTOR_CONFORMANCE_CASES: readonly ConformanceCase[] = [
  // --- Script contract & JSON boundary
  { name: "returns the script's value", code: "return 1 + 1;", expect: { ok: true, value: 2 } },
  { name: "returns null for undefined", code: "const x = 1;", expect: { ok: true, value: null } },
  {
    name: "supports top-level await",
    code: "const v = await Promise.resolve(41); return v + 1;",
    expect: { ok: true, value: 42 },
  },
  {
    name: "serializes the result as JSON only",
    code: "return { d: new Date(0), f: () => 1, u: undefined, n: NaN, nested: [undefined] };",
    expect: { ok: true, value: { d: "1970-01-01T00:00:00.000Z", n: null, nested: [null] } },
  },
  {
    name: "fails a non-JSON-serializable result with a typed error",
    code: "return 10n;",
    expect: { ok: false, errorName: "CodeScriptError" },
  },
  {
    name: "runs in strict mode (assigning an undeclared variable throws)",
    code: "undeclaredVariable = 1; return 'sloppy';",
    expect: { ok: false, errorName: "CodeScriptError" },
  },

  // --- Bridge
  {
    name: "round-trips a bridged call with JSON arguments",
    code: "return await mantle.items.get(7);",
    expect: { ok: true, value: { id: 7 } },
    check: (result, bridge) =>
      sameJson(bridge.log, [{ path: "items", method: "get", args: [7] }]) && result.calls === 1
        ? undefined
        : `unexpected bridge log ${JSON.stringify(bridge.log)} / calls ${result.calls}`,
  },
  {
    name: "passes JSON-only arguments to the host",
    code: "await mantle.items.get({ when: new Date(0), fn: () => 1 }); return 'ok';",
    expect: { ok: true, value: "ok" },
    check: (_result, bridge) =>
      sameJson(bridge.log[0]?.args, [{ when: "1970-01-01T00:00:00.000Z" }])
        ? undefined
        : `host saw ${JSON.stringify(bridge.log[0]?.args)}`,
  },
  {
    name: "runs sequential bridged calls",
    code: "const a = await mantle.items.find(); const b = await mantle.items.get(a[1].id); return b;",
    expect: { ok: true, value: { id: 2 } },
  },
  {
    name: "runs Promise.all bridged calls concurrently",
    code: "return await Promise.all([mantle.items.slow(), mantle.items.slow(), mantle.items.slow()]);",
    expect: { ok: true, value: ["slow", "slow", "slow"] },
    check: (_result, _bridge, elapsedMs) =>
      elapsedMs < SLOW_MS * 2.5 ? undefined : `took ${Math.round(elapsedMs)}ms — bridged calls ran serially`,
  },
  {
    name: "exposes a rejected call's MantleError shape to the script",
    code: "try { await mantle.items.fail(); } catch (e) { return { name: e.name, message: e.message, code: e.code, className: e.className, data: e.data, hint: e.hint, isError: e instanceof Error }; }",
    expect: {
      ok: true,
      value: {
        name: "NotFound",
        message: "Item missing",
        code: 404,
        className: "not-found",
        data: { id: "x" },
        hint: "Check the id.",
        isError: true,
      },
    },
  },
  {
    name: "surfaces an uncaught service error as its own class",
    code: "await mantle.items.fail();",
    expect: { ok: false, errorName: "NotFound" },
    check: (result) => (!result.ok && result.error.code === 404 ? undefined : "expected a 404 NotFound"),
  },
  {
    name: "fails an uncaught script error as CodeScriptError",
    code: "const o = null; return o.x;",
    expect: { ok: false, errorName: "CodeScriptError" },
  },
  {
    name: "fails a syntax error as CodeScriptError",
    code: "return (;",
    expect: { ok: false, errorName: "CodeScriptError" },
  },
  {
    name: "only exposes the bridge's methods",
    code: "return [typeof mantle.items.get, typeof mantle.items.remove, typeof mantle.other, Object.keys(mantle)];",
    expect: { ok: true, value: ["function", "undefined", "undefined", ["items"]] },
  },
  {
    name: "freezes the mantle API",
    code: "mantle.items = null;",
    expect: { ok: false, errorName: "CodeScriptError" },
  },
  {
    name: "captures console output",
    code: "console.log('hello', 1, { a: true }); console.error('bad'); return 'ok';",
    expect: { ok: true, value: "ok" },
    check: (result) =>
      sameJson(result.logs, ['[log] hello 1 {"a":true}', "[error] bad"])
        ? undefined
        : `logs ${JSON.stringify(result.logs)}`,
  },

  // --- Isolation
  {
    name: "starts every execution with fresh state",
    before: { code: "globalThis.leak = 42; return 1;" },
    code: "return typeof globalThis.leak;",
    expect: { ok: true, value: "undefined" },
  },
  {
    name: "isolates concurrent executions",
    concurrency: 10,
    code: "const id = Math.random(); globalThis.mine = id; const r = await mantle.items.get(id); return r.id === id && globalThis.mine === id;",
    expect: { ok: true, value: true },
  },
  {
    name: "has no host globals",
    code: "return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof setInterval, typeof XMLHttpRequest, typeof WebSocket, typeof Deno, typeof Bun, typeof __mantleCall, typeof __mantleFinish];",
    expect: { ok: true, value: Array(11).fill("undefined") },
  },
  {
    name: "leaks nothing through the Function constructor",
    code: "const g = Function('return this')(); const h = mantle.items.get.constructor.constructor('return this')(); return [typeof g.process, typeof h.process, typeof g.require, g === globalThis];",
    expect: { ok: true, value: ["undefined", "undefined", "undefined", true] },
  },
  {
    name: "cannot import modules",
    code: "await import('fs');",
    expect: { ok: false, errorName: "CodeScriptError" },
  },

  // --- Limits
  {
    name: "stops a CPU loop at the deadline",
    limits: { timeoutMs: 200 },
    code: "while (true) {}",
    expect: { ok: false, errorName: "CodeTimeout" },
    check: (_result, _bridge, elapsedMs) => (elapsedMs < 1500 ? undefined : `took ${Math.round(elapsedMs)}ms`),
  },
  {
    name: "stops a CPU loop that starts after a bridged call",
    limits: { timeoutMs: 200 },
    code: "await mantle.items.get(1); while (true) {}",
    expect: { ok: false, errorName: "CodeTimeout" },
  },
  {
    name: "stops a never-settling bridged call at the deadline",
    limits: { timeoutMs: 200 },
    code: "await mantle.items.never();",
    expect: { ok: false, errorName: "CodeTimeout" },
  },
  {
    name: "recovers after a timeout with a call still pending",
    before: { code: "await mantle.items.never();", limits: { timeoutMs: 100 } },
    code: "return await mantle.items.get(3);",
    expect: { ok: true, value: { id: 3 } },
  },
  {
    name: "stops a memory bomb at the memory cap",
    code: "const a = []; for (;;) a.push(new Array(1e5).fill(1));",
    expect: { ok: false, errorName: "CodeLimitExceeded" },
  },
  {
    name: "stops a string bomb",
    code: "let s = 'x'; for (;;) s += s;",
    expect: { ok: false, errorName: "CodeLimitExceeded" },
  },
  {
    name: "stops deep recursion at the stack limit",
    code: "const f = (n) => f(n + 1) + 1; return f(0);",
    expect: { ok: false, errorName: "CodeLimitExceeded" },
  },
  {
    name: "contains an unsafe stack limit as a typed failure",
    limits: { stackBytes: 4 * 1024 * 1024 },
    code: "const f = (n) => f(n + 1) + 1; return f(0);",
    expect: { ok: false, errorName: ["CodeLimitExceeded", "CodeExecutorFault"] },
  },
  {
    name: "enforces the bridged-call cap even when the script catches it",
    limits: { maxCalls: 3 },
    code: "for (let i = 0; i < 5; i++) { try { await mantle.items.get(i); } catch {} } return 'swallowed';",
    expect: { ok: false, errorName: "CodeLimitExceeded" },
    check: (_result, bridge) => (bridge.log.length === 3 ? undefined : `${bridge.log.length} calls reached the host`),
  },
  {
    name: "fails an oversized result",
    limits: { maxOutputBytes: 1024 },
    code: "return 'x'.repeat(2048);",
    expect: { ok: false, errorName: "CodeOutputTooLarge" },
  },
  {
    name: "truncates oversized log output",
    limits: { maxOutputBytes: 200 },
    code: "for (let i = 0; i < 100; i++) console.log('line ' + i); return 'ok';",
    expect: { ok: true, value: "ok" },
    check: (result) =>
      result.logsTruncated && result.logs.join("\n").length <= 200 ? undefined : "logs were not truncated",
  },
];
