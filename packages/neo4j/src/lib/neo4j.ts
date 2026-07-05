import neo4jDriver from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import type { MantleApplication, MantlePlugin } from "@mantlejs/mantle";

export interface Neo4jOptions {
  /** Neo4j Bolt URI. Default: 'bolt://localhost:7687' */
  uri?: string;
  /** Authentication credentials */
  auth: { username: string; password: string };
  /** Neo4j database name. Default: 'neo4j' */
  database?: string;
}

/**
 * Mantle plugin that opens a Neo4j driver connection and stores it on the application.
 *
 * @example
 * ```ts
 * const app = mantle().configure(
 *   neo4j({ uri: process.env.NEO4J_URI, auth: { username: 'neo4j', password: process.env.NEO4J_PASSWORD } })
 * );
 * ```
 */
export function neo4j(options: Neo4jOptions): MantlePlugin {
  return (app: MantleApplication): void => {
    const uri = options.uri ?? process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
    const database = options.database ?? process.env["NEO4J_DATABASE"] ?? "neo4j";
    const driver = neo4jDriver.driver(uri, neo4jDriver.auth.basic(options.auth.username, options.auth.password));
    app.set("neo4j", driver);
    app.set("neo4j:database", database);
  };
}

export type { Driver };
