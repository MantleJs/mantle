import { describe, expect, it } from "vitest";
import { CODE_EXECUTOR_CONFORMANCE_CASES, conformanceBridge } from "./conformance.js";
import { MIN_WASM_MEMORY_BYTES, quickJsExecutor } from "./quickjs-executor.js";
import type { CodeExecutionResult } from "./types.js";
import { DEFAULT_CODE_LIMITS } from "./types.js";

/**
 * Phase 7 PRD spec 4: the shared executor conformance suite, run against the default
 * `quickJsExecutor()`. Any other `CodeExecutor` can run the same loop.
 */
describe("quickJsExecutor — conformance", () => {
  const executor = quickJsExecutor();

  for (const testCase of CODE_EXECUTOR_CONFORMANCE_CASES) {
    it(testCase.name, async () => {
      if (testCase.before) {
        await executor.execute(testCase.before.code, conformanceBridge(), {
          ...DEFAULT_CODE_LIMITS,
          ...testCase.before.limits,
        });
      }
      const limits = { ...DEFAULT_CODE_LIMITS, ...testCase.limits };
      const runs = await Promise.all(
        Array.from({ length: testCase.concurrency ?? 1 }, async () => {
          const bridge = conformanceBridge();
          const started = performance.now();
          const result = await executor.execute(testCase.code, bridge, limits);
          return { result, bridge, elapsedMs: performance.now() - started };
        }),
      );

      for (const { result, bridge, elapsedMs } of runs) {
        const expected = testCase.expect;
        if (expected.ok) {
          expect(result.ok ? undefined : result.error.toJSON()).toBeUndefined();
          if ("value" in expected)
            expect((result as Extract<CodeExecutionResult, { ok: true }>).value).toEqual(expected.value);
        } else {
          expect(result.ok).toBe(false);
          const names = Array.isArray(expected.errorName) ? expected.errorName : [expected.errorName];
          expect(names).toContain((result as Extract<CodeExecutionResult, { ok: false }>).error.name);
        }
        expect(testCase.check?.(result, bridge, elapsedMs)).toBeUndefined();
      }
    });
  }
});

describe("quickJsExecutor — host safety", () => {
  const executor = quickJsExecutor();

  it("keeps the host process healthy through repeated limit breaches", async () => {
    const bombs = [
      "while (true) {}",
      "const a = []; for (;;) a.push(new Array(1e5).fill(1));",
      "const f = (n) => f(n + 1) + 1; return f(0);",
    ];
    for (let round = 0; round < 3; round++) {
      for (const code of bombs) {
        const result = await executor.execute(code, conformanceBridge(), { ...DEFAULT_CODE_LIMITS, timeoutMs: 200 });
        expect(result.ok).toBe(false);
      }
    }
    const healthy = await executor.execute("return 'still alive';", conformanceBridge(), DEFAULT_CODE_LIMITS);
    expect(healthy).toMatchObject({ ok: true, value: "still alive" });
  });

  it("rejects a wasmMemoryBytes below the engine's initial memory as a typed failure", async () => {
    const result = await executor.execute("return 1;", conformanceBridge(), {
      ...DEFAULT_CODE_LIMITS,
      wasmMemoryBytes: MIN_WASM_MEMORY_BYTES - 1,
    });
    expect(result.ok).toBe(false);
    expect((result as Extract<CodeExecutionResult, { ok: false }>).error.name).toBe("BadRequest");
  });

  it("never rejects — failures are { ok: false }", async () => {
    await expect(
      executor.execute("throw 'plain string';", conformanceBridge(), DEFAULT_CODE_LIMITS),
    ).resolves.toMatchObject({
      ok: false,
    });
  });

  it("reports line numbers that match the script", async () => {
    const result = await executor.execute(
      "const a = 1;\nconst b = 2;\nnull.boom;",
      conformanceBridge(),
      DEFAULT_CODE_LIMITS,
    );
    expect(result.ok).toBe(false);
    const data = (result as Extract<CodeExecutionResult, { ok: false }>).error.data as { stack?: string };
    expect(data.stack).toContain("agent.js:3");
  });
});
