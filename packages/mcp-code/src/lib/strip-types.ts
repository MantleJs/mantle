import * as nodeModule from "node:module";
import { BadRequest } from "@mantlejs/mantle";

type StripTypeScriptTypes = (code: string, options?: { mode?: "strip" | "transform" }) => string;

/** Node ≥ 22.13 ships `module.stripTypeScriptTypes`; older runtimes get JS-only input. */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes?: StripTypeScriptTypes })
  .stripTypeScriptTypes;

const PREFIX = "(async () => {";
const SUFFIX = "\n})";

/** True when agent TypeScript is accepted (types stripped host-side before execution). */
export function supportsTypeScript(): boolean {
  return typeof stripTypeScriptTypes === "function";
}

/**
 * Strip TypeScript types from an agent script, host-side, before it reaches the sandbox.
 * Types become whitespace, so line/column positions are preserved and plain JS passes through
 * unchanged. The script is wrapped in an async function first because the stripper rejects a
 * top-level `return`. Type *checking* is out of scope — errors surface at runtime. On runtimes
 * without the stripper the code is returned as-is (JS only; a TS-only construct then fails as
 * a syntax error in the sandbox).
 */
export function stripTypes(code: string): string {
  if (stripTypeScriptTypes === undefined) return code;
  let stripped: string;
  try {
    stripped = stripTypeScriptTypes(`${PREFIX}${code}${SUFFIX}`, { mode: "strip" });
  } catch (error) {
    const codeName = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (codeName === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") {
      throw new BadRequest(
        `The script uses TypeScript syntax that can't be type-stripped: ${message}`,
        undefined,
        undefined,
        "Use plain objects instead of enum, and modules/objects instead of namespace — only erasable type annotations are supported.",
      );
    }
    throw new BadRequest(
      `The script failed to parse: ${message}`,
      undefined,
      undefined,
      "Send the body of an async function: top-level await and return are allowed.",
    );
  }
  return stripped.slice(PREFIX.length, stripped.length - SUFFIX.length);
}
