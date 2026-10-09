type JsonObject = Record<string, unknown>;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `name` as a TypeScript property key — bare when it's an identifier, quoted otherwise. */
export function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/** A JSDoc block for `text` at `indent`, or "" when there is no text. */
export function jsDoc(text: string | undefined, indent: string): string {
  if (text === undefined || text.trim() === "") return "";
  const lines = text.replace(/\*\//g, "*\\/").split("\n");
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((line) => `${indent} * ${line}`).join("\n")}\n${indent} */\n`;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function union(parts: string[]): string {
  const unique = [...new Set(parts)];
  return unique.length === 1 ? (unique[0] as string) : unique.map(wrapIfComposite).join(" | ");
}

/** True when `type` has a `|` or `&` outside any brackets or string literal (i.e. it's a union/intersection). */
function hasTopLevelOperator(type: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < type.length; i++) {
    const char = type[i];
    if (quote !== undefined) {
      if (char === "\\") i++;
      else if (char === quote) quote = undefined;
    } else if (char === '"') quote = char;
    else if (char === "{" || char === "(" || char === "[" || char === "<") depth++;
    else if (char === "}" || char === ")" || char === "]" || char === ">") depth--;
    else if (depth === 0 && (char === "|" || char === "&")) return true;
  }
  return false;
}

/** Parenthesize unions/intersections so they nest safely inside another `|`/`&`. */
function wrapIfComposite(type: string): string {
  return hasTopLevelOperator(type) ? `(${type})` : type;
}

function arrayOf(type: string): string {
  return hasTopLevelOperator(type) || type.includes("\n") ? `Array<${type}>` : `${type}[]`;
}

/**
 * Render a JSON Schema (the subset TypeBox and the MCP tool schemas use) as a TypeScript type
 * expression. Unknown or unsupported keywords degrade to `unknown`, never to a wrong type.
 * `indent` is the indentation of the line the type starts on; nested object members go one
 * level deeper. Property `description`s become JSDoc comments, so the agent reads the same
 * guidance the tool-mode JSON Schema carries.
 */
export function schemaToTs(schema: unknown, indent = ""): string {
  if (schema === true || schema === undefined) return "unknown";
  if (schema === false) return "never";
  if (!isObject(schema)) return "unknown";

  if ("const" in schema) return JSON.stringify(schema["const"]) ?? "unknown";
  if (Array.isArray(schema["enum"])) {
    const literals = schema["enum"].map((value) => JSON.stringify(value) ?? "unknown");
    return literals.length > 0 ? union(literals) : "never";
  }
  const variants = Array.isArray(schema["anyOf"]) ? schema["anyOf"] : schema["oneOf"];
  if (Array.isArray(variants)) {
    return variants.length > 0 ? union(variants.map((variant) => schemaToTs(variant, indent))) : "never";
  }
  if (Array.isArray(schema["allOf"])) {
    const parts = schema["allOf"].map((part) => wrapIfComposite(schemaToTs(part, indent)));
    return parts.length > 0 ? parts.join(" & ") : "unknown";
  }

  const type = schema["type"];
  if (Array.isArray(type)) {
    return union(type.map((single) => schemaToTs({ ...schema, type: single }, indent)));
  }
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return arrayOf(schemaToTs(schema["items"], indent));
    case "object":
      return objectToTs(schema, indent);
    default:
      // No `type`: an object if it declares members, otherwise any JSON value.
      return isObject(schema["properties"]) || "additionalProperties" in schema
        ? objectToTs(schema, indent)
        : "unknown";
  }
}

function objectToTs(schema: JsonObject, indent: string): string {
  const properties = isObject(schema["properties"]) ? schema["properties"] : {};
  const required = new Set(Array.isArray(schema["required"]) ? schema["required"].map(String) : []);
  const additional = schema["additionalProperties"];
  const inner = `${indent}  `;

  const members = Object.entries(properties).map(([name, propertySchema]) => {
    const description = isObject(propertySchema) ? propertySchema["description"] : undefined;
    const optional = required.has(name) ? "" : "?";
    return `${jsDoc(typeof description === "string" ? description : undefined, inner)}${inner}${propertyKey(
      name,
    )}${optional}: ${schemaToTs(propertySchema, inner)};`;
  });
  const shape = members.length > 0 ? `{\n${members.join("\n")}\n${indent}}` : undefined;

  // Index signature for open objects. Kept as a separate intersection member so it can't
  // conflict with the declared properties' types (a TS error inside a single object literal).
  const indexType =
    additional === false
      ? undefined
      : isObject(additional)
        ? schemaToTs(additional, inner)
        : members.length > 0
          ? undefined
          : "unknown";
  if (indexType === undefined) return shape ?? "Record<string, never>";
  const index = `{ [key: string]: ${indexType} }`;
  return shape !== undefined ? `${shape} & ${index}` : index;
}
