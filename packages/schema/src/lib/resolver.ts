import type { HookContext, HookFunction, Paginated } from "@mantlejs/mantle";

export type FieldResolver<T, K extends keyof T, C = undefined> = (
  value: T[K] | undefined,
  data: T,
  context: HookContext,
  shared: C,
) => Promise<T[K] | undefined> | T[K] | undefined;

export type ResolverMap<T, C = undefined> = {
  [K in keyof T]?: FieldResolver<T, K, C>;
};

export interface ResolverOptions<T, C> {
  /**
   * Called once per record before field resolvers run. The return value is
   * passed as the fourth argument to every field resolver in the map.
   * Use this to perform a single async lookup shared across multiple fields.
   */
  createContext?: (record: T, ctx: HookContext) => Promise<C> | C;
}

async function applyMap<T, C>(data: T, map: ResolverMap<T, C>, ctx: HookContext, shared: C): Promise<T> {
  const out = { ...(data as Record<string, unknown>) };
  for (const key of Object.keys(map) as (keyof T & string)[]) {
    const fn = map[key];
    if (!fn) continue;
    const resolved = await fn(data[key], data, ctx, shared);
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
export function resolver<T, C = undefined>(map: ResolverMap<T, C>, options?: ResolverOptions<T, C>): HookFunction {
  const { createContext } = options ?? {};

  return async function resolverHook(ctx) {
    if (ctx.result === undefined || ctx.result === null) return ctx;

    if (Array.isArray(ctx.result)) {
      ctx.result = (await Promise.all(
        (ctx.result as unknown as T[]).map(async (record) => {
          const shared = createContext ? await createContext(record, ctx) : (undefined as C);
          return applyMap(record, map, ctx, shared);
        }),
      )) as unknown as typeof ctx.result;
    } else if (isPaginated<T>(ctx.result)) {
      const paginated = ctx.result as Paginated<T>;
      paginated.data = await Promise.all(
        paginated.data.map(async (record) => {
          const shared = createContext ? await createContext(record, ctx) : (undefined as C);
          return applyMap(record, map, ctx, shared);
        }),
      );
    } else {
      const record = ctx.result as unknown as T;
      const shared = createContext ? await createContext(record, ctx) : (undefined as C);
      ctx.result = (await applyMap(record, map, ctx, shared)) as unknown as typeof ctx.result;
    }

    return ctx;
  };
}
