import type { MantleError } from "@mantlejs/mantle";

/**
 * Per-execution caps. Defaults (`DEFAULT_CODE_LIMITS`) come from the Phase 7 sandbox spike
 * (PRD Decisions #12–13). Every limit fails the execution with a typed `MantleError`; none can
 * take down the host process.
 */
export interface CodeLimits {
  /** Wall-clock deadline: interrupt handler for CPU loops, host timer for a bridged call that never settles. @default 10000 */
  timeoutMs: number;
  /** QuickJS `setMemoryLimit` — a soft cap (it undercounts some allocations). @default 32 MiB */
  memoryBytes: number;
  /** Bounded `WebAssembly.Memory` maximum — the hard cap, enforced by the WASM engine. @default 64 MiB */
  wasmMemoryBytes: number;
  /**
   * QuickJS `setMaxStackSize`. QuickJS runs on the host thread's native stack, so keep this under
   * ~¼ of it (~256 KiB on Node's default main-thread stack). @default 192 KiB
   */
  stackBytes: number;
  /** Bridged service calls allowed per execution. @default 50 */
  maxCalls: number;
  /** Cap on the JSON-serialized result, and separately on captured log output. @default 64 KiB */
  maxOutputBytes: number;
}

export const DEFAULT_CODE_LIMITS: CodeLimits = {
  timeoutMs: 10_000,
  memoryBytes: 32 * 1024 * 1024,
  wasmMemoryBytes: 64 * 1024 * 1024,
  stackBytes: 192 * 1024,
  maxCalls: 50,
  maxOutputBytes: 64 * 1024,
};

/**
 * The host side of the sandbox's `mantle` API. `services` is the API's shape (path → method
 * names) — the executor builds `mantle[path][method](...args)` inside the sandbox from it and
 * nothing else. `call` receives the JSON-decoded positional arguments and resolves with a
 * JSON-serializable value, or rejects (a `MantleError`'s `toJSON()` shape reaches the script).
 */
export interface CodeBridge {
  services: Record<string, string[]>;
  call(path: string, method: string, args: unknown[]): Promise<unknown>;
}

interface CodeExecutionOutcome {
  /** Captured `console.*` lines, `[level] message`, capped at `maxOutputBytes`. */
  logs: string[];
  /** True when log output hit `maxOutputBytes` and later lines were dropped. */
  logsTruncated: boolean;
  /** Bridged calls attempted (including any rejected by the `maxCalls` cap). */
  calls: number;
}

export type CodeExecutionResult =
  | (CodeExecutionOutcome & { ok: true; value: unknown })
  | (CodeExecutionOutcome & { ok: false; error: MantleError });

/**
 * Runs untrusted JavaScript (the body of an async function — `return` sends the result back,
 * top-level `await` works) against a bridge. Contract, checked by `CODE_EXECUTOR_CONFORMANCE_CASES`:
 * fresh state per execution, JSON-only values across the boundary, no host capabilities beyond
 * `mantle` and `console`, every limit enforced with a typed error, and `execute` never rejects —
 * failures are `{ ok: false, error }`.
 */
export interface CodeExecutor {
  execute(code: string, bridge: CodeBridge, limits: CodeLimits): Promise<CodeExecutionResult>;
}
