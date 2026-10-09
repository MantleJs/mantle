import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSSyncVariant,
} from "quickjs-emscripten-core";
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from "quickjs-emscripten-core";
import type { MantleError } from "@mantlejs/mantle";
import { BadRequest, MantleError as MantleErrorClass } from "@mantlejs/mantle";
import { CodeExecutorFault, CodeLimitExceeded, CodeOutputTooLarge, CodeTimeout } from "./errors.js";
import { errorFromJson, toErrorJson } from "./error-json.js";
import type { CodeBridge, CodeExecutionResult, CodeExecutor, CodeLimits } from "./types.js";

// The variant package's typings are CJS-shaped (`module.exports.default`), while Node loads its
// ESM build, whose default export is the variant itself — accept either shape.
const importedVariant = releaseSync.default as unknown as QuickJSSyncVariant | { default: QuickJSSyncVariant };
const RELEASE_SYNC: QuickJSSyncVariant = "default" in importedVariant ? importedVariant.default : importedVariant;

/**
 * The slice of the WebAssembly JS API used here. The workspace's `lib`/`@types/node` don't
 * declare the `WebAssembly` global, so it's typed locally rather than pulling in `lib.dom`.
 */
interface WasmModule {
  readonly __wasmModule?: never;
}
interface WasmApi {
  compile(bytes: Uint8Array): Promise<WasmModule>;
  Memory: new (descriptor: { initial: number; maximum: number }) => object;
}
const wasm = (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

const WASM_PAGE_BYTES = 65_536;
/** The QuickJS build's initial linear memory (16 MiB) — `wasmMemoryBytes` may not go below it. */
export const MIN_WASM_MEMORY_BYTES = 256 * WASM_PAGE_BYTES;

let compiledModule: Promise<WasmModule> | undefined;

/** Compile the QuickJS WASM binary once per process; every execution instantiates it fresh. */
function compileQuickJs(): Promise<WasmModule> {
  compiledModule ??= (async () => {
    const wasmPath = createRequire(import.meta.url).resolve("@jitl/quickjs-wasmfile-release-sync/wasm");
    return wasm.compile(await readFile(wasmPath));
  })();
  return compiledModule;
}

/**
 * The default `CodeExecutor`: QuickJS (sync WASM build) with host calls bridged as guest
 * promises. Every execution gets a **fresh WASM instance with its own bounded
 * `WebAssembly.Memory`** — the only hard memory cap (QuickJS's own limit is soft), memory is
 * reclaimed after a bomb, and an instance poisoned by a host-side fault is simply discarded.
 * See PRD Decisions #12–13 for the measurements behind each choice.
 */
export function quickJsExecutor(): CodeExecutor {
  return {
    async execute(code: string, bridge: CodeBridge, limits: CodeLimits): Promise<CodeExecutionResult> {
      const state: ExecutionState = { logs: [], logBytes: 0, logsTruncated: false, calls: 0 };
      try {
        if (limits.wasmMemoryBytes < MIN_WASM_MEMORY_BYTES) {
          throw new BadRequest(
            `CodeLimits.wasmMemoryBytes must be at least ${MIN_WASM_MEMORY_BYTES} (the QuickJS build's initial memory)`,
          );
        }
        const wasmModule = await compileQuickJs();
        const quickJs = await newQuickJSWASMModuleFromVariant(
          newVariant(RELEASE_SYNC, {
            wasmModule: wasmModule as never,
            wasmMemory: new wasm.Memory({
              initial: MIN_WASM_MEMORY_BYTES / WASM_PAGE_BYTES,
              maximum: Math.floor(limits.wasmMemoryBytes / WASM_PAGE_BYTES),
            }) as never,
          }),
        );
        // Await before evaluating so the guest always starts on a fresh host stack (Decision #13).
        return await runInstance(quickJs.newRuntime(), code, bridge, limits, state);
      } catch (error) {
        return failure(state, asExecutorError(error));
      }
    },
  };
}

interface ExecutionState {
  logs: string[];
  logBytes: number;
  logsTruncated: boolean;
  calls: number;
}

function failure(state: ExecutionState, error: MantleError): CodeExecutionResult {
  return { ok: false, error, logs: state.logs, logsTruncated: state.logsTruncated, calls: state.calls };
}

function isMantleError(error: unknown): error is MantleError {
  return error instanceof MantleErrorClass;
}

/** Anything thrown on the host side of the sandbox that isn't already typed is an executor fault. */
function asExecutorError(error: unknown): MantleError {
  if (isMantleError(error)) return error;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new CodeExecutorFault(
    `The sandbox failed on the host: ${message.slice(0, 300)}`,
    undefined,
    undefined,
    "The sandbox instance was discarded. If this was deep recursion, reduce CodeLimits.stackBytes below ~1/4 of the host thread's stack.",
  );
}

/**
 * Guest prelude: builds the frozen `mantle` API from the bridge's shape, then removes the raw
 * bridge function from `globalThis` so only `mantle` can reach the host. `__finish` runs the
 * script once (removing itself first) and serializes the outcome to a JSON envelope inside the
 * guest, so only a string ever crosses back.
 */
function prelude(shape: Record<string, string[]>): string {
  return `"use strict";
(() => {
  const shape = ${JSON.stringify(shape)};
  const bridge = globalThis.__mantleCall;
  delete globalThis.__mantleCall;
  const unwrap = (text) => {
    const envelope = JSON.parse(text);
    if (envelope.ok) return envelope.value;
    throw Object.assign(new Error(envelope.error.message), envelope.error);
  };
  const api = {};
  for (const path of Object.keys(shape)) {
    const service = {};
    for (const method of shape[path]) {
      service[method] = async (...args) => unwrap(await bridge(path, method, JSON.stringify(args)));
    }
    api[path] = Object.freeze(service);
  }
  Object.defineProperty(globalThis, "mantle", { value: Object.freeze(api), enumerable: true });
  const serializeError = (e) => {
    if (e === null || typeof e !== "object") return { name: "Error", message: String(e) };
    const out = { name: String(e.name || "Error"), message: String(e.message) };
    for (const key of ["code", "className", "data", "hint", "stack"]) if (e[key] !== undefined) out[key] = e[key];
    return out;
  };
  globalThis.__mantleFinish = (fn) => {
    delete globalThis.__mantleFinish;
    return fn().then(
      (value) => {
        try {
          return JSON.stringify({ ok: true, value: value === undefined ? null : value });
        } catch (e) {
          return JSON.stringify({ ok: false, error: { name: "TypeError", message: "The script's return value is not JSON-serializable: " + String(e && e.message) } });
        }
      },
      (e) => JSON.stringify({ ok: false, error: serializeError(e) }),
    );
  };
})();
`;
}

/**
 * Wrap the script as an async function body (`return` + top-level `await`), in strict mode. The
 * wrapper shares the script's first line, so reported line numbers match the agent's code.
 */
function wrapScript(code: string): string {
  return `"use strict"; __mantleFinish(async () => { ${code}\n});`;
}

async function runInstance(
  runtime: QuickJSRuntime,
  code: string,
  bridge: CodeBridge,
  limits: CodeLimits,
  state: ExecutionState,
): Promise<CodeExecutionResult> {
  const deadline = Date.now() + limits.timeoutMs;
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const ctx = runtime.newContext();
  const deferreds = new Set<QuickJSDeferredPromise>();
  let fatal: MantleError | undefined;
  let abort: (error: MantleError) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = (error) => {
      fatal ??= error;
      reject(fatal);
    };
  });
  aborted.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Set when the engine threw on the host (e.g. a native stack overflow): the instance's state is
  // undefined, so it's abandoned to the garbage collector rather than torn down (teardown would
  // trip the engine's own leak assertion).
  let poisoned = false;
  const hostFault = (error: unknown): MantleError => {
    if (!isMantleError(error)) poisoned = true;
    return asExecutorError(error);
  };

  /** Run queued guest jobs; a guest-side fault while draining (interrupt, OOM) aborts the execution. */
  const drain = (): void => {
    if (!ctx.alive) return;
    try {
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        const dumped: unknown = ctx.dump(jobs.error);
        jobs.error.dispose();
        abort(guestFault(dumped, deadline, limits));
      }
    } catch (error) {
      abort(hostFault(error));
    }
  };

  try {
    installConsole(ctx, state, limits);
    installBridge(ctx, bridge, limits, state, deferreds, drain, (error) => {
      fatal ??= error;
    });

    const preludeResult = ctx.evalCode(prelude(bridge.services), "mantle-prelude.js");
    if (preludeResult.error) {
      const dumped: unknown = ctx.dump(preludeResult.error);
      preludeResult.error.dispose();
      throw new CodeExecutorFault(`Sandbox prelude failed: ${JSON.stringify(dumped)}`);
    }
    preludeResult.value.dispose();

    const evaluated = ctx.evalCode(wrapScript(code), "agent.js");
    if (evaluated.error) {
      const dumped: unknown = ctx.dump(evaluated.error);
      evaluated.error.dispose();
      return failure(state, guestFault(dumped, deadline, limits));
    }
    const promiseHandle = evaluated.value;
    const settledInGuest = ctx.resolvePromise(promiseHandle);
    drain();

    const hostDeadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(timeoutError(limits)), Math.max(0, deadline - Date.now()));
    });

    let settled: Awaited<typeof settledInGuest>;
    try {
      settled = await Promise.race([settledInGuest, hostDeadline, aborted]);
    } finally {
      if (promiseHandle.alive) promiseHandle.dispose();
    }
    if (settled.error) {
      const dumped: unknown = ctx.dump(settled.error);
      settled.error.dispose();
      return failure(state, fatal ?? guestFault(dumped, deadline, limits));
    }
    const envelopeText = ctx.getString(settled.value);
    settled.value.dispose();
    if (fatal) return failure(state, fatal);
    return finish(envelopeText, state, limits, deadline);
  } catch (error) {
    const typed = hostFault(error);
    return failure(state, fatal ?? typed);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!poisoned) {
      try {
        // Unsettled deferreds (e.g. a bridged call still pending at timeout) must be disposed
        // before the context, or freeing the runtime aborts the WASM instance (Decision #12).
        for (const deferred of deferreds) if (deferred.alive) deferred.dispose();
        ctx.dispose();
        runtime.dispose();
      } catch {
        // The instance is per-execution and already unreachable — a failed teardown just leaves
        // it to the garbage collector.
      }
    }
  }
}

function finish(
  envelopeText: string,
  state: ExecutionState,
  limits: CodeLimits,
  deadline: number,
): CodeExecutionResult {
  const envelope = JSON.parse(envelopeText) as
    | { ok: true; value: unknown }
    | { ok: false; error: Record<string, unknown> };
  if (!envelope.ok) return failure(state, guestFault(envelope.error, deadline, limits));

  const resultBytes = Buffer.byteLength(JSON.stringify(envelope.value));
  if (resultBytes > limits.maxOutputBytes) {
    return failure(
      state,
      new CodeOutputTooLarge(
        `The script's result is ${resultBytes} bytes; the limit is ${limits.maxOutputBytes}`,
        { resultBytes, maxOutputBytes: limits.maxOutputBytes },
        undefined,
        "Return less: aggregate or filter inside the script, page with query.limit/query.skip, or trim fields with query.select.",
      ),
    );
  }
  return { ok: true, value: envelope.value, logs: state.logs, logsTruncated: state.logsTruncated, calls: state.calls };
}

function timeoutError(limits: CodeLimits): CodeTimeout {
  return new CodeTimeout(
    `The script exceeded the ${limits.timeoutMs}ms time limit`,
    { timeoutMs: limits.timeoutMs },
    undefined,
    "Make fewer sequential calls (run independent calls with Promise.all), avoid long loops, or request less data.",
  );
}

/**
 * Map a failure reported by the guest — an uncaught script error, or an engine-level error
 * (interrupt, out of memory, stack overflow) — to a typed `MantleError`.
 */
function guestFault(dumped: unknown, deadline: number, limits: CodeLimits): MantleError {
  const error = (dumped !== null && typeof dumped === "object" ? dumped : { message: String(dumped) }) as Record<
    string,
    unknown
  >;
  const message = String(error["message"] ?? "");
  if (message === "interrupted" || Date.now() >= deadline) return timeoutError(limits);
  if (/out of memory|string too long|invalid array length/i.test(message)) {
    return new CodeLimitExceeded(
      `The script exceeded the sandbox memory limit (${message})`,
      { limit: "memory", memoryBytes: limits.memoryBytes, wasmMemoryBytes: limits.wasmMemoryBytes },
      undefined,
      "Process data in smaller pieces — page with query.limit/query.skip and keep only what the result needs.",
    );
  }
  if (/stack overflow|call stack/i.test(message)) {
    return new CodeLimitExceeded(
      `The script exceeded the sandbox stack limit (${message})`,
      { limit: "stack", stackBytes: limits.stackBytes },
      undefined,
      "Avoid deep recursion — use a loop instead.",
    );
  }
  return errorFromJson(error);
}

function installConsole(ctx: QuickJSContext, state: ExecutionState, limits: CodeLimits): void {
  const consoleHandle = ctx.newObject();
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const fn = ctx.newFunction(level, (...args: QuickJSHandle[]) => {
      const line = `[${level}] ${args
        .map((arg) => {
          const value: unknown = ctx.dump(arg);
          return typeof value === "string" ? value : JSON.stringify(value);
        })
        .join(" ")}`;
      const bytes = Buffer.byteLength(line) + 1;
      if (state.logsTruncated || state.logBytes + bytes > limits.maxOutputBytes) {
        state.logsTruncated = true;
        return;
      }
      state.logBytes += bytes;
      state.logs.push(line);
    });
    ctx.setProp(consoleHandle, level, fn);
    fn.dispose();
  }
  ctx.setProp(ctx.global, "console", consoleHandle);
  consoleHandle.dispose();
}

function installBridge(
  ctx: QuickJSContext,
  bridge: CodeBridge,
  limits: CodeLimits,
  state: ExecutionState,
  deferreds: Set<QuickJSDeferredPromise>,
  drain: () => void,
  markFatal: (error: MantleError) => void,
): void {
  const callFn = ctx.newFunction("__mantleCall", (pathHandle, methodHandle, argsHandle) => {
    const path = ctx.getString(pathHandle);
    const method = ctx.getString(methodHandle);
    const argsJson = ctx.getString(argsHandle);
    const deferred = ctx.newPromise();
    deferreds.add(deferred);
    state.calls += 1;

    const settle = (envelope: string): void => {
      if (!ctx.alive || !deferred.alive) return;
      const text = ctx.newString(envelope);
      deferred.resolve(text);
      text.dispose();
      drain();
    };

    if (state.calls > limits.maxCalls) {
      const error = new CodeLimitExceeded(
        `The script exceeded the limit of ${limits.maxCalls} service calls per execution`,
        { limit: "calls", maxCalls: limits.maxCalls },
        undefined,
        "Batch the work into fewer calls — e.g. one find with $in instead of many gets — or split it across executions.",
      );
      // A cap breach fails the execution even if the script catches it.
      markFatal(error);
      queueMicrotask(() => settle(JSON.stringify({ ok: false, error: error.toJSON() })));
      return deferred.handle;
    }

    void (async (): Promise<string> => {
      try {
        if (!bridge.services[path]?.includes(method)) {
          throw new BadRequest(`'${path}.${method}' is not part of the mantle API`);
        }
        const value = await bridge.call(path, method, JSON.parse(argsJson) as unknown[]);
        return JSON.stringify({ ok: true, value: value === undefined ? null : value });
      } catch (error) {
        return JSON.stringify({ ok: false, error: toErrorJson(error) });
      }
    })().then(settle);
    return deferred.handle;
  });
  ctx.setProp(ctx.global, "__mantleCall", callFn);
  callFn.dispose();
}
