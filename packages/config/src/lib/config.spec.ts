import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mantle } from "@mantlejs/core";
import { config } from "./config.js";

function writeJson(dir: string, name: string, data: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(data));
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `mantle-config-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("config plugin", () => {
  describe("file loading", () => {
    it("loads default.json", () => {
      writeJson(tmpDir, "default.json", { port: 3030 });
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      expect(app.get("config")).toEqual({ port: 3030 });
    });

    it("deep-merges env overlay over default", () => {
      writeJson(tmpDir, "default.json", { port: 3030, db: { client: "pg", pool: { min: 2, max: 10 } } });
      writeJson(tmpDir, "test.json", { port: 8080, db: { pool: { max: 25 } } });
      vi.stubEnv("NODE_ENV", "test");
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      expect(app.get("config")).toEqual({ port: 8080, db: { client: "pg", pool: { min: 2, max: 25 } } });
    });

    it("works when default.json is missing", () => {
      writeJson(tmpDir, "test.json", { port: 9090 });
      vi.stubEnv("NODE_ENV", "test");
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      expect(app.get("config")).toEqual({ port: 9090 });
    });

    it("works when env overlay file is missing", () => {
      writeJson(tmpDir, "default.json", { port: 3030 });
      vi.stubEnv("NODE_ENV", "nonexistent");
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      expect(app.get("config")).toEqual({ port: 3030 });
    });

    it("uses custom envVar option", () => {
      writeJson(tmpDir, "default.json", { port: 3030 });
      writeJson(tmpDir, "staging.json", { port: 5000 });
      vi.stubEnv("APP_ENV", "staging");
      const app = mantle();
      app.configure(config({ directory: tmpDir, envVar: "APP_ENV" }));
      expect(app.get<number>("port")).toBe(5000);
    });
  });

  describe("env var overrides", () => {
    it("applies top-level MANTLE_* override", () => {
      writeJson(tmpDir, "default.json", { port: 3030 });
      vi.stubEnv("MANTLE_PORT", "9999");
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      const cfg = app.get("config") as Record<string, unknown>;
      expect(cfg["port"]).toBe(9999);
    });

    it("applies nested override with double underscore", () => {
      writeJson(tmpDir, "default.json", { db: { pool: { max: 10 } } });
      vi.stubEnv("MANTLE_DB__POOL__MAX", "25");
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      const cfg = app.get("config") as { db: { pool: { max: number } } };
      expect(cfg.db.pool.max).toBe(25);
    });

    it("applies string override for non-number fields", () => {
      writeJson(tmpDir, "default.json", { name: "default" });
      vi.stubEnv("MANTLE_NAME", "override");
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      const cfg = app.get("config") as Record<string, unknown>;
      expect(cfg["name"]).toBe("override");
    });

    it("uses custom envPrefix", () => {
      writeJson(tmpDir, "default.json", { port: 3030 });
      vi.stubEnv("MYAPP_PORT", "7777");
      const app = mantle();
      app.configure(config({ directory: tmpDir, envPrefix: "MYAPP_" }));
      const cfg = app.get("config") as Record<string, unknown>;
      expect(cfg["port"]).toBe(7777);
    });

    it("ignores MANTLE_ vars when custom envPrefix is set", () => {
      writeJson(tmpDir, "default.json", { port: 3030 });
      vi.stubEnv("MANTLE_PORT", "9999");
      vi.stubEnv("MYAPP_PORT", "7777");
      const app = mantle();
      app.configure(config({ directory: tmpDir, envPrefix: "MYAPP_" }));
      const cfg = app.get("config") as Record<string, unknown>;
      expect(cfg["port"]).toBe(7777);
    });

    it("coerces boolean overrides", () => {
      writeJson(tmpDir, "default.json", { debug: false });
      vi.stubEnv("MANTLE_DEBUG", "true");
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      const cfg = app.get("config") as Record<string, unknown>;
      expect(cfg["debug"]).toBe(true);
    });
  });

  describe("app.set side-effects", () => {
    it("sets each top-level key individually on app", () => {
      writeJson(tmpDir, "default.json", { port: 3030, name: "my-app" });
      const app = mantle();
      app.configure(config({ directory: tmpDir }));
      expect(app.get("port")).toBe(3030);
      expect(app.get("name")).toBe("my-app");
    });

    it("returns app for chaining", () => {
      writeJson(tmpDir, "default.json", {});
      const app = mantle();
      expect(app.configure(config({ directory: tmpDir }))).toBe(app);
    });
  });

  describe("schema validation", () => {
    it("passes when config matches schema", async () => {
      const { Type } = await import("@sinclair/typebox");
      const schema = Type.Object({ port: Type.Number() });
      writeJson(tmpDir, "default.json", { port: 3030 });
      const app = mantle();
      expect(() => app.configure(config({ directory: tmpDir, schema }))).not.toThrow();
    });

    it("throws GeneralError when config does not match schema", async () => {
      const { Type } = await import("@sinclair/typebox");
      const schema = Type.Object({ port: Type.Number() });
      writeJson(tmpDir, "default.json", { port: "not-a-number" });
      const app = mantle();
      expect(() => app.configure(config({ directory: tmpDir, schema }))).toThrow(
        expect.objectContaining({ name: "GeneralError", message: "Invalid configuration" }),
      );
    });

    it("includes field-level error details", async () => {
      const { Type } = await import("@sinclair/typebox");
      const schema = Type.Object({ port: Type.Number() });
      writeJson(tmpDir, "default.json", { port: "bad" });
      const app = mantle();
      expect(() => app.configure(config({ directory: tmpDir, schema }))).toThrow(
        expect.objectContaining({
          data: { errors: expect.arrayContaining([expect.objectContaining({ field: expect.any(String) })]) },
        }),
      );
    });
  });
});
