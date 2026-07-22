import { GeneralError } from "@mantlejs/mantle";
import type { Logger } from "@mantlejs/mantle";
import { pinoAdapter } from "./pino-adapter.js";
import type { PinoLike } from "./pino-adapter.js";
import { SENSITIVE_PATHS } from "./redact.js";

export interface CreateLoggerOptions {
  /** Default: "info" when NODE_ENV === "production", else "debug". */
  level?: "debug" | "info" | "warn" | "error";
  /** Pino redact paths. Default: SENSITIVE_PATHS. Pass [] to disable. */
  redact?: string[];
  /** Pretty-print via pino-pretty when available. Default: false. Ignored in production. */
  pretty?: boolean;
  /** Google Cloud structured logging: level -> `severity` labels, message key "message". Default: false. */
  gcp?: boolean;
  /** Extra pino options merged last (escape hatch). */
  pino?: Record<string, unknown>;
}

type PinoFactory = (options: Record<string, unknown>) => PinoLike;

const GCP_SEVERITY: Record<string, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

async function loadPino(): Promise<PinoFactory> {
  try {
    const mod = (await import("pino")) as { default?: PinoFactory } & Partial<PinoFactory>;
    return (mod.default ?? (mod as unknown as PinoFactory)) as PinoFactory;
  } catch {
    throw new GeneralError(
      "createLogger() requires the optional peer dependency 'pino', which is not installed.",
      undefined,
      undefined,
      "Install it with: npm install pino",
    );
  }
}

let warnedMissingPinoPretty = false;

async function isPinoPrettyAvailable(): Promise<boolean> {
  try {
    await import("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

/** Builds a Logger backed by pino, with production-ready defaults for level, redaction, and GCP severity mapping. */
export async function createLogger(options: CreateLoggerOptions = {}): Promise<Logger> {
  const isProduction = process.env["NODE_ENV"] === "production";
  const level = options.level ?? (isProduction ? "info" : "debug");
  const redactPathsList = options.redact ?? SENSITIVE_PATHS;

  const pinoOptions: Record<string, unknown> = { level };

  if (redactPathsList.length > 0) {
    pinoOptions["redact"] = { paths: redactPathsList, censor: "[Redacted]" };
  }

  if (options.gcp) {
    pinoOptions["messageKey"] = "message";
    pinoOptions["formatters"] = {
      level: (label: string) => ({ severity: GCP_SEVERITY[label] ?? label.toUpperCase() }),
    };
  }

  if (options.pretty && !isProduction) {
    if (await isPinoPrettyAvailable()) {
      pinoOptions["transport"] = { target: "pino-pretty" };
    } else if (!warnedMissingPinoPretty) {
      warnedMissingPinoPretty = true;
      console.warn(
        "[@mantlejs/logger] pretty: true was set but 'pino-pretty' is not installed — falling back to plain output. Install it with: npm install -D pino-pretty",
      );
    }
  }

  Object.assign(pinoOptions, options.pino ?? {});

  const pino = await loadPino();
  return pinoAdapter(pino(pinoOptions));
}
