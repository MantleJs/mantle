import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { GeneralError } from "@mantlejs/core";
import type { MantlePlugin } from "@mantlejs/core";
import type { TSchema } from "@sinclair/typebox";

export interface ConfigOptions {
  /** Directory containing config files. Default: process.cwd() + '/config' */
  directory?: string;
  /** TypeBox schema — validates merged config at startup, throws GeneralError on failure */
  schema?: TSchema;
  /** Env var that selects the environment overlay. Default: 'NODE_ENV' */
  envVar?: string;
  /** Prefix for env var overrides. Default: 'MANTLE_' */
  envPrefix?: string;
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// PREFIX_KEY=val → config.key = val
// PREFIX_A__B__C=val → config.a.b.c = val
function applyEnvOverrides(cfg: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const result = deepMerge(cfg, {});
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (!envKey.startsWith(prefix) || envVal === undefined) continue;
    const parts = envKey.slice(prefix.length).toLowerCase().split("__");
    let target = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (typeof target[part] !== "object" || target[part] === null || Array.isArray(target[part])) {
        target[part] = {};
      }
      target = target[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    const existing = target[leaf];
    if (typeof existing === "number") {
      target[leaf] = Number(envVal);
    } else if (typeof existing === "boolean") {
      target[leaf] = envVal === "true" || envVal === "1";
    } else {
      target[leaf] = envVal;
    }
  }
  return result;
}

const ajv = new Ajv({ allErrors: true, strict: false });

function validateSchema(schema: TSchema, data: unknown): void {
  const fn = ajv.compile(schema);
  if (!fn(data)) {
    const errors = (fn.errors ?? []).map((e) => ({ field: e.instancePath, message: e.message ?? "invalid" }));
    throw new GeneralError("Invalid configuration", { errors });
  }
}

export function config(options: ConfigOptions = {}): MantlePlugin {
  return (app) => {
    const directory = options.directory ?? join(process.cwd(), "config");
    const envVar = options.envVar ?? "NODE_ENV";
    const envPrefix = options.envPrefix ?? "MANTLE_";
    const env = process.env[envVar] ?? "development";

    const base = readJson(join(directory, "default.json")) ?? {};
    const overlay = readJson(join(directory, `${env}.json`)) ?? {};
    let merged = deepMerge(base, overlay);
    merged = applyEnvOverrides(merged, envPrefix);

    if (options.schema) {
      validateSchema(options.schema, merged);
    }

    app.set("config", merged);
    for (const [key, value] of Object.entries(merged)) {
      app.set(key, value);
    }
  };
}
