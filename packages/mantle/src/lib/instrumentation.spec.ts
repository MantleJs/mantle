import { describe, expect, it } from "vitest";
import { BadRequest } from "./errors.js";
import type { CallInstrumentation, HookPhase } from "./instrumentation.js";
import { addInstrumentation } from "./instrumentation.js";
import { mantle } from "./mantle.js";
import type { HookContext, HookFunction } from "./types.js";

type Record_ = { id: string };

/** Records every callback, tagged with the instrumentation's name. */
function recorder(name: string, log: string[]): { start(context: HookContext): CallInstrumentation } {
  return {
    start(context) {
      log.push(`${name}:start ${context.path}.${context.method}`);
      return {
        async run(fn) {
          log.push(`${name}:run`);
          return fn();
        },
        hook(phase: HookPhase, hook: HookFunction, error?: unknown) {
          log.push(`${name}:hook ${phase} ${hook.name}${error ? " threw" : ""}`);
        },
        end(context, error) {
          log.push(
            `${name}:end ${error instanceof Error ? error.message : "ok"} result=${JSON.stringify(context.result)}`,
          );
        },
      };
    },
  };
}

function app() {
  const instance = mantle();
  instance.use<Record_>("items", {
    async get(id) {
      if (id === "boom") throw new BadRequest("boom");
      return { id: String(id) };
    },
  });
  return instance;
}

describe("addInstrumentation", () => {
  it("observes start, each hook, and end around a successful call", async () => {
    const log: string[] = [];
    const instance = app();
    addInstrumentation(instance, recorder("a", log));
    const audit: HookFunction = (context) => context;
    const stamp: HookFunction = (context) => context;
    instance.service("items").hooks({ before: { get: [audit] }, after: { all: [stamp] } });

    await expect(instance.service("items").get("1")).resolves.toEqual({ id: "1" });
    expect(log).toEqual([
      "a:start items.get",
      "a:run",
      "a:hook before audit",
      "a:hook after stamp",
      'a:end ok result={"id":"1"}',
    ]);
  });

  it("passes the caller's error to end and marks the failing hook", async () => {
    const log: string[] = [];
    const instance = app();
    addInstrumentation(instance, recorder("a", log));
    const guard: HookFunction = () => {
      throw new BadRequest("denied");
    };
    const report: HookFunction = (context) => context;
    instance.service("items").hooks({ before: { get: [guard] }, error: { get: [report] } });

    await expect(instance.service("items").get("1")).rejects.toThrow("denied");
    expect(log.slice(2)).toEqual(["a:hook before guard threw", "a:hook error report", "a:end denied result=undefined"]);
  });

  it("reports success when an error hook recovers", async () => {
    const log: string[] = [];
    const instance = app();
    addInstrumentation(instance, recorder("a", log));
    const recover: HookFunction = (context) => ({ ...context, error: undefined, result: { id: "fallback" } });
    instance.service("items").hooks({ error: { get: [recover] } });

    await expect(instance.service("items").get("boom")).resolves.toEqual({ id: "fallback" });
    expect(log.at(-1)).toBe('a:end ok result={"id":"fallback"}');
  });

  it("nests multiple instrumentations, first registered outermost", async () => {
    const log: string[] = [];
    const instance = app();
    addInstrumentation(instance, recorder("outer", log));
    addInstrumentation(instance, recorder("inner", log));

    await instance.service("items").get("1");
    expect(log.filter((entry) => entry.endsWith(":run"))).toEqual(["outer:run", "inner:run"]);
    expect(log.filter((entry) => entry.includes(":end"))).toHaveLength(2);
  });

  it("leaves a call unobserved when start returns undefined", async () => {
    const instance = app();
    addInstrumentation(instance, { start: () => undefined });
    await expect(instance.service("items").get("1")).resolves.toEqual({ id: "1" });
  });

  it("observes internal calls made from hooks inside the outer call's run", async () => {
    const log: string[] = [];
    const instance = app();
    instance.use<Record_>("other", {
      async get(id) {
        return { id: String(id) };
      },
    });
    addInstrumentation(instance, recorder("a", log));
    const lookup: HookFunction = async (context) => {
      await context.app.service("other").get("x");
      return context;
    };
    instance.service("items").hooks({ before: { get: [lookup] } });

    await instance.service("items").get("1");
    const lifecycle = log
      .filter((entry) => /^a:(start|end)/.test(entry))
      .map((entry) => entry.replace(/ result=.*/, ""));
    expect(lifecycle).toEqual(["a:start items.get", "a:start other.get", "a:end ok", "a:end ok"]);
  });
});
