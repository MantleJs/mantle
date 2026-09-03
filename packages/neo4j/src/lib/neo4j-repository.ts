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

  /** Property written for auto-managed creation timestamps. @default "createdAt" */
  readonly createdAtField: string = "createdAt";
  /** Property written for auto-managed update timestamps. @default "updatedAt" */
  readonly updatedAtField: string = "updatedAt";
  /**
   * Entity-field-to-node-property overrides, for a label whose property names don't
   * match the entity (e.g. a brownfield graph using snake_case). @default {}
   */
  readonly fieldMap: Record<string, string> = {};

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

  /** Translates an entity field name to its node property name (fieldMap override, else identity). */
  protected toField(field: string): string {
    return this.fieldMap[field] ?? field;
  }

  /** Translates a node property name back to its entity field name — the inverse of `toField`. */
  protected toEntityField(field: string): string {
    const mapped = Object.entries(this.fieldMap).find(([, prop]) => prop === field);
    return mapped ? mapped[0] : field;
  }

  protected toEntity(props: Record<string, unknown>): T {
    return Object.fromEntries(Object.entries(props).map(([key, value]) => [this.toEntityField(key), value])) as T;
  }

  protected buildProps(data: Partial<T>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([field, value]) => [this.toField(field), value]),
    );
  }

  // ─── GraphRepository methods ──────────────────────────────────────────────

  async createNode(data: Partial<T>): Promise<T> {
    try {
      const now = new Date().toISOString();
      const id = (data as Record<string, unknown>)[this.idField] ?? crypto.randomUUID();
      const props: Record<string, unknown> = {
        ...this.buildProps(data),
        [this.toField(this.idField)]: id,
        ...(this.timestamps
          ? { [this.toField(this.createdAtField)]: now, [this.toField(this.updatedAtField)]: now }
          : {}),
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
        const result = await session.run(`MATCH (n:${this.label} {${this.toField(this.idField)}: $id}) RETURN n`, {
          id: String(id),
        });
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
          const { clause, params: wp } = toNeo4jWhere(params.where as WhereClause, "n", (field) => this.toField(field));
          if (clause && clause !== "true") {
            query += ` WHERE ${clause}`;
          }
          whereParams = wp;
        }

        query += " RETURN n";

        if (params?.sort) {
          const sortParts = Object.entries(params.sort).map(([field, dir]) => {
            const prop = this.toField(field);
            assertValidFieldName(prop);
            if (dir !== "asc" && dir !== "desc") {
              throw new BadRequest(`Invalid sort direction: ${String(dir)}`);
            }
            return `n.${prop} ${dir.toUpperCase()}`;
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

  async createRelationship(fromId: Id, toId: Id, type: string, properties?: Record<string, unknown>): Promise<void> {
    try {
      await this.run(async (session) => {
        const props = properties ?? {};
        const idProp = this.toField(this.idField);
        await session.run(
          `MATCH (a:${this.label} {${idProp}: $from}), (b:${this.label} {${idProp}: $to}) ` +
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
          `MATCH (start:${this.label} {${this.toField(this.idField)}: $id})-[r:${relation}*1..${depth}]->(n) RETURN n`,
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
        await session.run(`MATCH (n:${this.label} {${this.toField(this.idField)}: $id}) DETACH DELETE n`, {
          id: String(id),
        });
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
