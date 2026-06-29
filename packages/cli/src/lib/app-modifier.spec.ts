import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { modifyAppFile } from "./app-modifier.js";

const tmpFile = join(tmpdir(), `mantle-test-app-${Date.now()}.ts`);

afterEach(async () => {
  try {
    await unlink(tmpFile);
  } catch {
    // file may not exist
  }
});

describe("modifyAppFile", () => {
  it("inserts named import and configure call into app.ts", async () => {
    await writeFile(
      tmpFile,
      [
        'import { mantle } from "@mantlejs/mantle";',
        'import { express } from "@mantlejs/express";',
        "",
        "export const app = mantle()",
        "  .configure(express());",
      ].join("\n"),
      "utf-8",
    );

    const result = await modifyAppFile(tmpFile, {
      imports: [{ names: ["socketio"], path: "@mantlejs/socketio" }],
      configureCall: "socketio()",
    });

    expect(result).toBe(true);
    const content = await readFile(tmpFile, "utf-8");
    expect(content).toContain('import { socketio } from "@mantlejs/socketio";');
    expect(content).toContain(".configure(socketio())");
  });

  it("appends configure after existing chain", async () => {
    await writeFile(
      tmpFile,
      [
        'import { mantle } from "@mantlejs/mantle";',
        "",
        "export const app = mantle()",
        "  .configure(express());",
      ].join("\n"),
      "utf-8",
    );

    await modifyAppFile(tmpFile, {
      imports: [{ names: ["logger"], path: "@mantlejs/logger" }],
      configureCall: "logger()",
    });

    const content = await readFile(tmpFile, "utf-8");
    const configureIdx = content.indexOf(".configure(express())");
    const newIdx = content.indexOf(".configure(logger())");
    expect(newIdx).toBeGreaterThan(configureIdx);
  });

  it("handles default imports", async () => {
    await writeFile(
      tmpFile,
      [
        'import { mantle } from "@mantlejs/mantle";',
        "",
        "export const app = mantle();",
      ].join("\n"),
      "utf-8",
    );

    const result = await modifyAppFile(tmpFile, {
      imports: [
        { defaultImport: "pino", path: "pino" },
        { names: ["logger", "pinoAdapter"], path: "@mantlejs/logger" },
      ],
      configureCall: `logger(pinoAdapter(pino({ level: "info" })))`,
    });

    expect(result).toBe(true);
    const content = await readFile(tmpFile, "utf-8");
    expect(content).toContain('import pino from "pino";');
    expect(content).toContain('import { logger, pinoAdapter } from "@mantlejs/logger";');
  });

  it("returns false for a non-existent file", async () => {
    const result = await modifyAppFile("/non/existent/path/app.ts", {
      imports: [{ names: ["foo"], path: "foo" }],
      configureCall: "foo()",
    });
    expect(result).toBe(false);
  });

  it("returns false when no mantle() chain is found", async () => {
    await writeFile(
      tmpFile,
      [
        'import express from "express";',
        "",
        "const app = express();",
      ].join("\n"),
      "utf-8",
    );

    const result = await modifyAppFile(tmpFile, {
      imports: [{ names: ["logger"], path: "@mantlejs/logger" }],
      configureCall: "logger()",
    });
    expect(result).toBe(false);
  });
});
