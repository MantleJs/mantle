import { createHash, randomUUID } from "node:crypto";
import type { MantleError, ServiceParams } from "@mantlejs/mantle";
import { BadRequest } from "@mantlejs/mantle";
import type { McpCodeModeProvider, McpMethodRunner, McpToolDefinition } from "@mantlejs/mcp";
import { createServiceMethodRunner } from "@mantlejs/mcp";
import { resolveAgentScope } from "./agent-scope.js";
import { buildApiModel, renderDeclarations, renderIndex, toToolArguments } from "./declarations.js";
import { quickJsExecutor } from "./quickjs-executor.js";
import { stripTypes, supportsTypeScript } from "./strip-types.js";
import type { CodeBridge, CodeExecutor, CodeLimits } from "./types.js";
import { DEFAULT_CODE_LIMITS } from "./types.js";

export interface CodeModeOptions {
  /** The sandbox. @default quickJsExecutor() */
  executor?: CodeExecutor;
  /** Override any of `DEFAULT_CODE_LIMITS`. */
  limits?: Partial<CodeLimits>;
  /**
   * Also put the full script source in `params.mcp.script` (and so in every audit record it
   * reaches). Off by default — scripts can embed data — and `params.mcp.scriptHash` (SHA-256) is
   * always present to correlate a record with the script that made it. @default false
   */
  auditScriptSource?: boolean;
}

/**
 * Per-call metadata code mode adds to `params.mcp` on every bridged service call, readable by
 * any hook (and recorded by `@mantlejs/audit`). All calls from one `execute` share `executionId`.
 */
export interface CodeModeCallMetadata {
  mode: "code";
  executionId: string;
  /** SHA-256 (hex) of the script as submitted. */
  scriptHash: string;
  /** The script as submitted — only with `auditScriptSource: true`. */
  script?: string;
}

/** What `execute` returns to the agent on success. */
export interface CodeExecutionReport {
  result: unknown;
  executionId: string;
  calls: number;
  logs: string[];
  /** Notes from bridged calls (e.g. a truncated find page) and the log-truncation notice. */
  notes?: string[];
}

export const API_RESOURCE_URI = "mantle://code/api.d.ts";

const EXECUTE_DESCRIPTION = `Run a script against the typed Mantle API. The script is the body of an async function: use \`await mantle.<path>.<method>(...)\` (see search_api or ${API_RESOURCE_URI} for the API), and \`return\` the result. Do filtering, joins, and aggregation in the script so only the final answer comes back. Values cross as JSON; console.log output is captured. A failed service call throws an Error with the service error's name/message/code/data/hint — catch it to branch, e.g. \`if (e.name === "NotFound")\`. No network, filesystem, timers, or imports.

Example:
const { data } = await mantle.articles.find({ where: { status: "published" }, limit: 100, select: ["id", "tags"] });
const counts = {};
for (const a of data) for (const t of a.tags ?? []) counts[t] = (counts[t] ?? 0) + 1;
return counts;`;

const SEARCH_DESCRIPTION = `Look up the typed Mantle API (TypeScript declarations) for the scripts you pass to execute. With no arguments, returns a one-line index of the services and methods. Pass \`query\` (keywords matched against service paths, method names, and descriptions) or \`paths\` (exact service paths) to get the declarations you need.`;

function resolveLimits(overrides: Partial<CodeLimits> | undefined): CodeLimits {
  const limits = { ...DEFAULT_CODE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequest(`codeMode() limits.${key} must be a positive integer, got '${String(value)}'`);
    }
  }
  return limits;
}

/**
 * MCP code mode: instead of one tool per service method, the agent gets a typed TypeScript API
 * of the exposed services plus two tools — `search_api` (load declarations piece by piece) and
 * `execute` (run a script against the API in a sandbox) — and the `mantle://code/api.d.ts`
 * resource. Pass the result as `mcp({ codeMode: codeMode() })`.
 *
 * Every `mantle.<path>.<method>()` call inside a script dispatches through the exact runner
 * tool mode uses (`createServiceMethodRunner` from `@mantlejs/mcp`) with the session's params,
 * `provider: "mcp"`, and `params.mcp` set (see `CodeModeCallMetadata`) — so the service's full
 * hook pipeline, including `authorizeAgent()` and `@mantlejs/audit`, applies to each call. The
 * expose map is the hard boundary: only exposed methods exist in the sandbox.
 */
export function codeMode(options: CodeModeOptions = {}): McpCodeModeProvider {
  const executor = options.executor ?? quickJsExecutor();
  const limits = resolveLimits(options.limits);
  if (typeof executor.execute !== "function") {
    throw new BadRequest("codeMode() executor must implement execute(code, bridge, limits)");
  }

  return {
    build({ app, services, query }) {
      const models = buildApiModel(services, query);
      const runners = new Map<string, McpMethodRunner>();
      const shape: Record<string, string[]> = {};
      for (const service of services) {
        shape[service.path] = [...service.methods];
        for (const method of service.methods) {
          runners.set(
            `${service.path}\u0000${method}`,
            createServiceMethodRunner(app, service.descriptor, method, query),
          );
        }
      }

      const searchApi: McpToolDefinition = {
        name: "search_api",
        description: SEARCH_DESCRIPTION,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", description: "Keywords, e.g. 'articles tags'." },
            paths: { type: "array", items: { type: "string" }, description: "Exact service paths." },
          },
        },
        handler: async (args, ctx) => {
          const { query: keywords, paths } = (args ?? {}) as { query?: unknown; paths?: unknown };
          const scope = await resolveAgentScope(ctx.app, ctx.params);
          const filters = {
            scope,
            ...(typeof keywords === "string" && keywords.trim() !== "" ? { query: keywords } : {}),
            ...(Array.isArray(paths) ? { paths: paths.map(String) } : {}),
          };
          if (filters.query === undefined && filters.paths === undefined) {
            const index = renderIndex(models, { scope });
            return `${index || "(no services visible to this session)"}\n\nPass query or paths for TypeScript declarations.`;
          }
          return renderDeclarations(models, filters);
        },
      };

      const execute: McpToolDefinition = {
        name: "execute",
        description: supportsTypeScript()
          ? `${EXECUTE_DESCRIPTION}\n\nTypeScript type annotations are allowed (stripped before running; enum/namespace are not).`
          : `${EXECUTE_DESCRIPTION}\n\nPlain JavaScript only.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", description: "Body of an async function. `return` the result." } },
        },
        handler: async (args, ctx): Promise<CodeExecutionReport> => {
          const code = (args as { code?: unknown } | undefined)?.code;
          if (typeof code !== "string" || code.trim() === "") {
            throw new BadRequest("execute requires a non-empty 'code' string");
          }
          const javascript = stripTypes(code);
          const metadata: CodeModeCallMetadata = {
            mode: "code",
            executionId: randomUUID(),
            scriptHash: createHash("sha256").update(code).digest("hex"),
            ...(options.auditScriptSource === true ? { script: code } : {}),
          };
          const notes: string[] = [];

          const bridge: CodeBridge = {
            services: shape,
            async call(path, method, callArgs) {
              const runner = runners.get(`${path}\u0000${method}`);
              if (runner === undefined) {
                throw new BadRequest(`'${path}.${method}' is not part of the mantle API`);
              }
              // Fresh params per call — hooks may mutate them, and calls must not bleed into each other.
              const params: ServiceParams = {
                ...ctx.params,
                headers: { ...ctx.params.headers },
                mcp: { ...metadata },
              };
              const { result, note } = await runner(toToolArguments(method, callArgs), params);
              if (note !== undefined) notes.push(`${path}.${method}: ${note}`);
              return result;
            },
          };

          const outcome = await executor.execute(javascript, bridge, limits);
          if (outcome.logsTruncated) {
            notes.push(`Console output exceeded ${limits.maxOutputBytes} bytes; later lines were dropped.`);
          }
          if (!outcome.ok) {
            throw withExecution(outcome.error, {
              executionId: metadata.executionId,
              calls: outcome.calls,
              logs: outcome.logs,
              ...(notes.length > 0 ? { notes } : {}),
            });
          }
          return {
            result: outcome.value,
            executionId: metadata.executionId,
            calls: outcome.calls,
            logs: outcome.logs,
            ...(notes.length > 0 ? { notes } : {}),
          };
        },
      };

      return {
        tools: [searchApi, execute],
        resources: [
          {
            uri: API_RESOURCE_URI,
            name: "Mantle API (TypeScript declarations)",
            description: "The typed API execute scripts run against — narrowed to an agent token's scope.",
            mimeType: "text/plain",
            read: async (ctx) => renderDeclarations(models, { scope: await resolveAgentScope(ctx.app, ctx.params) }),
          },
        ],
      };
    },
  };
}

type ErrorClass = new (message?: string, data?: unknown, errors?: unknown[], hint?: string) => MantleError;

/**
 * Attach the execution's id, call count, logs, and notes to the error the agent sees, keeping
 * its class (name/code/className/message/hint) — the original `data`, if any, moves to `cause`.
 */
function withExecution(error: MantleError, execution: Record<string, unknown>): MantleError {
  const ErrorConstructor = error.constructor as ErrorClass;
  return new ErrorConstructor(
    error.message,
    { ...(error.data !== undefined ? { cause: error.data } : {}), execution },
    error.errors,
    error.hint,
  );
}
