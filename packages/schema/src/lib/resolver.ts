import type { HookContext, HookFunction, Paginated } from "@mantlejs/core";

export type FieldResolver<T, K extends keyof T> = (
  value: T[K] | undefined,
  data: T,
  context: HookContext,
) => Promise<T[K] | undefined> | T[K] | undefined;

export type ResolverMap<T> = {
  [K in keyof T]?: FieldResolver<T, K>;
};

async function applyMap<T>(data: T, map: ResolverMap<T>, ctx: HookContext): Promise<T> {
  const out = { ...(data as Record<string, unknown>) };
  for (const key of Object.keys(map) as (keyof T & string)[]) {
    const fn = map[key];
    if (!fn) continue;
    const resolved = await fn(data[key], data, ctx);
    if (resolved === undefined) {
      delete out[key];
    } else {
      out[key] = resolved as unknown;
    }
  }
  return out as T;
}

function isPaginated<T>(value: unknown): value is Paginated<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    Array.isArray((value as Record<string, unknown>)["data"])
  );
}

/** Transforms context.result field-by-field. Returning undefined from a resolver removes that field. */
export function resolver<T>(map: ResolverMap<T>): HookFunction {
  return async function resolverHook(ctx) {
    if (ctx.result === undefined || ctx.result === null) return ctx;

    if (Array.isArray(ctx.result)) {
      ctx.result = (await Promise.all(
        (ctx.result as unknown as T[]).map((record) => applyMap(record, map, ctx)),
      )) as unknown as typeof ctx.result;
    } else if (isPaginated<T>(ctx.result)) {
      const paginated = ctx.result as Paginated<T>;
      paginated.data = await Promise.all(paginated.data.map((record) => applyMap(record, map, ctx)));
    } else {
      ctx.result = (await applyMap(ctx.result as unknown as T, map, ctx)) as unknown as typeof ctx.result;
    }

    return ctx;
  };
}
