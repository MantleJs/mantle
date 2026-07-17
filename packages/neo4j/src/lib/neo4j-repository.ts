import type { Driver, Session } from "neo4j-driver";
import type { Id, QueryParams, GraphRepository, RepositoryCapabilities } from "@mantlejs/mantle";
import { BadRequest, GeneralError, MantleError, NotFound } from "@mantlejs/mantle";
import type { MantleApplication } from "@mantlejs/mantle";
import { assertValidFieldName, toNeo4jWhere, NEO4J_OPERATORS } from "./neo4j-where.js";
import type { WhereClause } from "./neo4j-where.js";

/**
 * A Mantle `GraphRepository<T>` implementation backed by Neo4j.
 *
 * Subclasses must declare `readonly label: string` — the Neo4j node label.
 * Each node stores a UUID `id` property plus all entity fields as node properties.
 *
 * @template T  The entity shape. Must extend `Record<string, unknown>`.
 */
export abstract class Neo4jRepository<T extends Record<string, unknown>> implements GraphRepository<T> {
  protected readonly driver: Driver;
  protected readonly database: string;

  /** The Neo4j node label. Override in subclass. */
  abstract readonly label: string;

  /** The property used as the node identifier. @default "id" */
  readonly idField: string = "id";

  /** When true, auto-write `createdAt` / `updatedAt` ISO-8601 timestamps. @default true */
  readonly timestamps: boolean = true;

  constructor(app: MantleApplication) {
    this.driver = app.get<Driver>("neo4j");
    this.database = app.get<string>("neo4j:database") ?? "neo4j";
  }

  describe(): RepositoryCapabilities {
    return {
      adapter: "@mantlejs/neo4j",
      operators: [...NEO4J_OPERATORS],
      pagination: "offset",
      fullTextSearch: false,
    };
  }

  // ─── Session helpers ──────────────────────────────────────────────────────

  protected openSession(): Session {
    return this.driver.session({ database: this.database });
  }

  protected async run<R>(fn: (session: Session) => Promise<R>): Promise<R> {
    const session = this.openSession();
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  // ─── Record ↔ node helpers ────────────────────────────────────────────────

  protected recordToNode(record: import("neo4j-driver").Record): T {
    const node = record.get("n") as { properties: Record<string, unknown> };
    return this.toEntity(node.properties);
  }

  protected toEntity(props: Record<string, unknown>): T {
    return props as T;
  }

  protected buildProps(data: Partial<T>): Record<string, unknown> {
    return data as Record<string, unknown>;
  }

  // ─── GraphRepository methods ──────────────────────────────────────────────

  async createNode(data: Partial<T>): Promise<T> {
    try {
      const now = new Date().toISOString();
      const id = (data as Record<string, unknown>)[this.idField] ?? crypto.randomUUID();
      const props: Record<string, unknown> = {
        ...this.buildProps(data),
        [this.idField]: id,
        ...(this.timestamps ? { createdAt: now, updatedAt: now } : {}),
      };
      return await this.run(async (session) => {
        const result = await session.run(`CREATE (n:${this.label} $props) RETURN n`, { props });
        const record = result.records[0];
        if (!record) throw new GeneralError("Failed to create node");
        return this.recordToNode(record);
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async findNodeById(id: Id): Promise<T | null> {
    try {
      return await this.run(async (session) => {
        const result = await session.run(
          `MATCH (n:${this.label} {${this.idField}: $id}) RETURN n`,
          { id: String(id) },
        );
        const first = result.records[0];
        if (!first) return null;
        return this.recordToNode(first);
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async findNodes(params?: QueryParams): Promise<T[]> {
    try {
      return await this.run(async (session) => {
        let query = `MATCH (n:${this.label})`;
        let whereParams: Record<string, unknown> = {};

        if (params?.where) {
          const { clause, params: wp } = toNeo4jWhere(params.where as WhereClause, "n");
          if (clause && clause !== "true") {
            query += ` WHERE ${clause}`;
          }
          whereParams = wp;
        }

        query += " RETURN n";

        if (params?.sort) {
          const sortParts = Object.entries(params.sort).map(([field, dir]) => {
            assertValidFieldName(field);
            if (dir !== "asc" && dir !== "desc") {
              throw new BadRequest(`Invalid sort direction: ${String(dir)}`);
            }
            return `n.${field} ${dir.toUpperCase()}`;
          });
          query += ` ORDER BY ${sortParts.join(", ")}`;
        }

        if (params?.skip != null) {
          query += ` SKIP ${params.skip}`;
        }
        if (params?.limit != null) {
          query += ` LIMIT ${params.limit}`;
        }

        const result = await session.run(query, whereParams);
        return result.records.map((r) => this.recordToNode(r));
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRelationship(
    fromId: Id,
    toId: Id,
    type: string,
    properties?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.run(async (session) => {
        const props = properties ?? {};
        await session.run(
          `MATCH (a:${this.label} {${this.idField}: $from}), (b:${this.label} {${this.idField}: $to}) ` +
            `CREATE (a)-[r:${type} $props]->(b)`,
          { from: String(fromId), to: String(toId), props },
        );
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async traverse(startId: Id, relation: string, depth = 1): Promise<T[]> {
    try {
      return await this.run(async (session) => {
        const result = await session.run(
          `MATCH (start:${this.label} {${this.idField}: $id})-[r:${relation}*1..${depth}]->(n) RETURN n`,
          { id: String(startId) },
        );
        return result.records.map((r) => this.recordToNode(r));
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteNode(id: Id): Promise<T> {
    try {
      return await this.run(async (session) => {
        const existing = await this.findNodeById(id);
        if (!existing) throw new NotFound(`No node found with ${this.idField} = ${id}`);
        await session.run(
          `MATCH (n:${this.label} {${this.idField}: $id}) DETACH DELETE n`,
          { id: String(id) },
        );
        return existing;
      });
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async raw<R = T>(query: string, params?: Record<string, unknown>): Promise<R[]> {
    try {
      return await this.run(async (session) => {
        const result = await session.run(query, params ?? {});
        return result.records.map((r) => {
          const keys = r.keys as string[];
          if (keys.length === 1 && keys[0]) {
            const val = r.get(keys[0]) as { properties?: Record<string, unknown> };
            return (val?.properties ?? val) as R;
          }
          const obj: Record<string, unknown> = {};
          for (const key of keys) {
            obj[key] = r.get(key);
          }
          return obj as R;
        });
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ─── Transaction support ──────────────────────────────────────────────────

  async withTransaction<R>(fn: (repo: this) => Promise<R>): Promise<R> {
    const session = this.openSession();
    try {
      return await session.executeWrite(async (tx) => {
        const txRepo = Object.create(this) as this;
        txRepo.run = async <X>(innerFn: (s: Session) => Promise<X>): Promise<X> => {
          const txSession = {
            run: tx.run.bind(tx),
            close: async () => undefined,
          } as unknown as Session;
          return innerFn(txSession);
        };
        return fn(txRepo);
      });
    } finally {
      await session.close();
    }
  }

  // ─── Error helper ─────────────────────────────────────────────────────────

  protected wrapError(err: unknown): Error {
    if (err instanceof MantleError) return err;
    if (err instanceof Error) return new GeneralError(err.message);
    return new GeneralError("An unknown Neo4j error occurred");
  }
}
