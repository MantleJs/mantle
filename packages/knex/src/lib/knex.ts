import knexLib from "knex";
import type { Knex } from "knex";
import type { MantleApplication, MantlePlugin } from "@mantlejs/core";

export interface KnexConfig {
  /** Knex client identifier: 'pg', 'mysql2', 'sqlite3', 'mssql', 'oracledb', etc. */
  client: string;
  connection: Knex.Config["connection"];
  pool?: { min?: number; max?: number };
  searchPath?: string | string[];
}

export function knex(config: KnexConfig): MantlePlugin {
  return (app: MantleApplication): void => {
    const instance = knexLib({
      client: config.client,
      connection: config.connection,
      pool: { min: 2, max: 10, ...config.pool },
      ...(config.searchPath ? { searchPath: config.searchPath } : {}),
    });
    app.set("knex", instance);

    const originalTeardown = (app as unknown as Record<string, unknown>)["teardown"] as () => Promise<void>;
    (app as unknown as Record<string, unknown>)["teardown"] = async () => {
      await originalTeardown.call(app);
      await instance.destroy();
    };
  };
}
