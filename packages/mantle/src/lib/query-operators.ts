import { BadRequest } from "./errors.js";

/**
 * Validate that every `$`-prefixed operator in a where clause is supported by the
 * adapter translating it. Recurses into `$or`/`$and` arrays and per-field operator
 * objects. Throws `BadRequest` naming the offending operator, the adapter, and the
 * full supported set — for an agent the error text is the documentation.
 *
 * Adapters call this at the top of their where-clause translators so an unsupported
 * operator fails loud instead of silently corrupting results.
 */
export function assertOperators(
  where: Record<string, unknown>,
  supported: ReadonlySet<string>,
  adapterName: string,
): void {
  for (const [key, value] of Object.entries(where)) {
    if (key === "$or" || key === "$and") {
      assertSupported(key, supported, adapterName);
      if (Array.isArray(value)) {
        for (const clause of value) {
          if (clause !== null && typeof clause === "object" && !Array.isArray(clause)) {
            assertOperators(clause as Record<string, unknown>, supported, adapterName);
          }
        }
      }
    } else if (key.startsWith("$")) {
      assertSupported(key, supported, adapterName);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const op of Object.keys(value as Record<string, unknown>)) {
        if (op.startsWith("$")) {
          assertSupported(op, supported, adapterName);
        }
      }
    }
  }
}

function assertSupported(op: string, supported: ReadonlySet<string>, adapterName: string): void {
  if (!supported.has(op)) {
    const list = [...supported].join(", ");
    throw new BadRequest(`Operator ${op} is not supported by ${adapterName}. Supported: ${list}`);
  }
}
