import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
  ScanCommand,
  QueryCommand,
  BatchWriteItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type { Id, QueryParams, Repository } from "@mantlejs/mantle";
import { BadRequest, Conflict, Forbidden, GeneralError, NotFound, Unavailable } from "@mantlejs/mantle";
import type { MantleApplication } from "@mantlejs/mantle";
import { dynamodbify, buildKeyCondition } from "./dynamodbify.js";
import type { WhereClause } from "./dynamodbify.js";

export interface DynamoQueryParams extends QueryParams {
  /** Cursor for the next page. Pass the `lastKey` from the previous `findAll()` call. */
  _startKey?: Record<string, AttributeValue>;
}

export abstract class DynamoDbRepository<T extends Record<string, unknown>, D = Partial<T>>
  implements Repository<T, D>
{
  protected readonly client: DynamoDBClient;

  /** DynamoDB table name. */
  abstract readonly tableName: string;

  /**
   * The partition key attribute name for the table.
   * @default "id"
   */
  readonly partitionKey: string = "id";

  /**
   * Optional sort key attribute name. When set, `findById` expects a composite
   * key object `{ pk: partitionValue, sk: sortValue }` and Query is used
   * instead of GetItem.
   */
  readonly sortKey?: string;

  /**
   * When true, `save` / `saveAll` / `updateById` / `patchById` automatically
   * write `createdAt` and `updatedAt` ISO-8601 timestamps.
   * @default true
   */
  readonly timestamps: boolean = true;

  /** The `LastEvaluatedKey` from the most recent paginated `findAll()` call. Use as `_startKey` on the next call. */
  lastKey?: Record<string, AttributeValue>;

  /** Buffered write operations when running inside `withTransaction()`. */
  protected _txItems?: TransactWriteItem[];

  constructor(app: MantleApplication) {
    this.client = app.get<DynamoDBClient>("dynamodb");
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private withTimestamps(
    data: Record<string, unknown>,
    op: "create" | "update",
    now = new Date(),
  ): Record<string, unknown> {
    if (!this.timestamps) return data;
    return op === "create"
      ? { ...data, createdAt: now.toISOString(), updatedAt: now.toISOString() }
      : { ...data, updatedAt: now.toISOString() };
  }

  /** Marshall a plain object to DynamoDB attribute values, omitting undefined/null keys. */
  protected toItem(data: Record<string, unknown>): Record<string, AttributeValue> {
    const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null));
    return marshall(cleaned, { removeUndefinedValues: true, convertEmptyValues: false });
  }

  /** Unmarshall a DynamoDB attribute map to a plain object. */
  protected fromItem(item: Record<string, AttributeValue>): T {
    return unmarshall(item) as T;
  }

  /** Build a consistent key map for GetItem / DeleteItem / UpdateItem. */
  protected buildKey(id: Id): Record<string, AttributeValue> {
    if (this.sortKey && typeof id === "object" && id !== null) {
      const composite = id as Record<string, unknown>;
      return marshall(
        {
          [this.partitionKey]: composite["pk"],
          [this.sortKey]: composite["sk"],
        },
        { removeUndefinedValues: true },
      );
    }
    return marshall({ [this.partitionKey]: id }, { removeUndefinedValues: true });
  }

  // ─── Repository implementation ────────────────────────────────────────────

  async findAll(params?: DynamoQueryParams): Promise<T[]> {
    try {
      const where = params?.where as WhereClause | undefined;

      if (where && this.sortKey) {
        // Prefer Query when a sort key is defined and the partition key is in the where clause
        const pkValue = where[this.partitionKey];
        if (pkValue !== undefined) {
          return await this.queryItems(params);
        }
      }

      return await this.scanItems(params);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async scanItems(params?: DynamoQueryParams): Promise<T[]> {
    const where = params?.where as WhereClause | undefined;
    let filterExpression: string | undefined;
    let expressionNames: Record<string, string> | undefined;
    let expressionValues: Record<string, AttributeValue> | undefined;

    if (where) {
      const built = dynamodbify(where);
      filterExpression = built.expression || undefined;
      if (filterExpression) {
        expressionNames = Object.keys(built.names).length > 0 ? built.names : undefined;
        expressionValues = Object.keys(built.values).length > 0 ? built.values : undefined;
      }
    }

    let projectionExpression: string | undefined;
    if (params?.select && params.select.length > 0) {
      const aliases: string[] = [];
      expressionNames = expressionNames ?? {};
      for (const field of params.select) {
        const alias = `#sel_${field}`;
        expressionNames[alias] = field;
        aliases.push(alias);
      }
      projectionExpression = aliases.join(", ");
    }

    const startKey = params?._startKey as Record<string, AttributeValue> | undefined;
    const skip = params?.skip ?? 0;
    const limit = params?.limit;

    let allItems: T[] = [];
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined = startKey;
    let skipped = 0;
    let firstPage = true;

    do {
      // Only use ExclusiveStartKey on subsequent pages when no explicit startKey is given
      const exclusiveStartKey = firstPage ? startKey : lastEvaluatedKey;
      firstPage = false;

      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: filterExpression,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
          ProjectionExpression: projectionExpression,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of result.Items ?? []) {
        if (skipped < skip) {
          skipped++;
          continue;
        }
        allItems.push(this.fromItem(item as Record<string, AttributeValue>));
        if (limit && allItems.length >= limit) break;
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, AttributeValue> | undefined;

      if (limit && allItems.length >= limit) {
        // Expose cursor for the next page
        this.lastKey = lastEvaluatedKey;
        break;
      }
    } while (lastEvaluatedKey);

    this.lastKey = lastEvaluatedKey;

    if (params?.sort) {
      allItems = this.applySort(allItems, params.sort);
    }

    return allItems;
  }

  private async queryItems(params?: DynamoQueryParams): Promise<T[]> {
    const where = params?.where as WhereClause;
    const { keyCondition, filterCondition, names, values } = buildKeyCondition(this.partitionKey, this.sortKey, where);

    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: keyCondition || undefined,
      FilterExpression: filterCondition,
      ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
      ExpressionAttributeValues: Object.keys(values).length > 0 ? values : undefined,
      Limit: params?.limit,
    });

    const result = await this.client.send(command);
    let items = (result.Items ?? []).map((item) => this.fromItem(item as Record<string, AttributeValue>));

    if (params?.sort) {
      items = this.applySort(items, params.sort);
    }

    const skip = params?.skip ?? 0;
    return skip > 0 ? items.slice(skip) : items;
  }

  private applySort(items: T[], sort: Record<string, "asc" | "desc">): T[] {
    if (!this.sortKey) {
      console.warn(
        `[DynamoDbRepository] Sorting "${Object.keys(sort).join(", ")}" on table "${this.tableName}" is done in memory. ` +
          `Define a sortKey or use a GSI for efficient ordering.`,
      );
    }
    return [...items].sort((a, b) => {
      for (const [field, dir] of Object.entries(sort)) {
        const av = a[field];
        const bv = b[field];
        if (av === bv) continue;
        const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
        return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }

  async findById(id: Id): Promise<T | null> {
    try {
      const result = await this.client.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: this.buildKey(id),
        }),
      );
      return result.Item ? this.fromItem(result.Item as Record<string, AttributeValue>) : null;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async save(data: D): Promise<T> {
    try {
      const raw = { ...(data as Record<string, unknown>) };
      if (!raw[this.partitionKey]) {
        raw[this.partitionKey] = crypto.randomUUID();
      }
      const payload = this.withTimestamps(raw, "create");
      const item = this.toItem(payload);

      if (this._txItems) {
        this._txItems.push({ Put: { TableName: this.tableName, Item: item } });
        return payload as unknown as T;
      }

      await this.client.send(new PutItemCommand({ TableName: this.tableName, Item: item }));
      return payload as unknown as T;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async saveAll(data: D[]): Promise<T[]> {
    try {
      const now = new Date();
      const payloads = data.map((d) => {
        const raw = { ...(d as Record<string, unknown>) };
        if (!raw[this.partitionKey]) {
          raw[this.partitionKey] = crypto.randomUUID();
        }
        return this.withTimestamps(raw, "create", now);
      });

      if (this._txItems) {
        for (const payload of payloads) {
          this._txItems.push({ Put: { TableName: this.tableName, Item: this.toItem(payload) } });
        }
        return payloads as unknown as T[];
      }

      // BatchWriteItem handles up to 25 requests per call
      const BATCH_SIZE = 25;
      for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
        const chunk = payloads.slice(i, i + BATCH_SIZE);
        await this.client.send(
          new BatchWriteItemCommand({
            RequestItems: {
              [this.tableName]: chunk.map((item) => ({
                PutRequest: { Item: this.toItem(item) },
              })),
            },
          }),
        );
      }

      return payloads as unknown as T[];
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateById(id: Id, data: D): Promise<T> {
    try {
      const payload = this.withTimestamps(data as Record<string, unknown>, "update");
      const item = this.toItem({ ...payload, [this.partitionKey]: this.extractId(id) });

      // Full replace — re-write all attributes except the key
      const key = this.buildKey(id);
      const withoutKey = Object.fromEntries(
        Object.entries(item).filter(([k]) => k !== this.partitionKey && k !== this.sortKey),
      );

      if (Object.keys(withoutKey).length === 0) {
        // Nothing to update beyond the key — item must exist
        const existing = await this.findById(id);
        if (!existing) throw new NotFound(`No item found with ${this.partitionKey} = ${String(id)}`);
        return existing;
      }

      const setExpressions: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, AttributeValue> = {};
      let idx = 0;

      for (const [attr, val] of Object.entries(withoutKey)) {
        const n = `#u${idx}`;
        const v = `:u${idx}`;
        names[n] = attr;
        values[v] = val as AttributeValue;
        setExpressions.push(`${n} = ${v}`);
        idx++;
      }

      if (this._txItems) {
        this._txItems.push({
          Update: {
            TableName: this.tableName,
            Key: key,
            UpdateExpression: `SET ${setExpressions.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ConditionExpression: `attribute_exists(${this.partitionKey})`,
          },
        });
        return payload as unknown as T;
      }

      const result = await this.client.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: `SET ${setExpressions.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: `attribute_exists(${this.partitionKey})`,
          ReturnValues: "ALL_NEW",
        }),
      );

      return this.fromItem(result.Attributes as Record<string, AttributeValue>);
    } catch (err) {
      if (err instanceof NotFound) throw err;
      if (this.isConditionalCheckFailed(err)) {
        throw new NotFound(`No item found with ${this.partitionKey} = ${String(id)}`);
      }
      throw this.wrapError(err);
    }
  }

  async patchById(id: Id, data: D): Promise<T> {
    try {
      const filtered = Object.fromEntries(
        Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined),
      );
      const payload = this.withTimestamps(filtered, "update");
      const item = this.toItem(payload);

      const key = this.buildKey(id);
      const withoutKey = Object.fromEntries(
        Object.entries(item).filter(([k]) => k !== this.partitionKey && k !== this.sortKey),
      );

      if (Object.keys(withoutKey).length === 0) {
        const existing = await this.findById(id);
        if (!existing) throw new NotFound(`No item found with ${this.partitionKey} = ${String(id)}`);
        return existing;
      }

      const setExpressions: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, AttributeValue> = {};
      let idx = 0;

      for (const [attr, val] of Object.entries(withoutKey)) {
        const n = `#p${idx}`;
        const v = `:p${idx}`;
        names[n] = attr;
        values[v] = val as AttributeValue;
        setExpressions.push(`${n} = ${v}`);
        idx++;
      }

      if (this._txItems) {
        this._txItems.push({
          Update: {
            TableName: this.tableName,
            Key: key,
            UpdateExpression: `SET ${setExpressions.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ConditionExpression: `attribute_exists(${this.partitionKey})`,
          },
        });
        return payload as unknown as T;
      }

      const result = await this.client.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: `SET ${setExpressions.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: `attribute_exists(${this.partitionKey})`,
          ReturnValues: "ALL_NEW",
        }),
      );

      return this.fromItem(result.Attributes as Record<string, AttributeValue>);
    } catch (err) {
      if (err instanceof NotFound) throw err;
      if (this.isConditionalCheckFailed(err)) {
        throw new NotFound(`No item found with ${this.partitionKey} = ${String(id)}`);
      }
      throw this.wrapError(err);
    }
  }

  async deleteById(id: Id): Promise<T> {
    try {
      if (this._txItems) {
        // Must fetch the item first since TransactWriteItems doesn't support ReturnValues
        const existing = await this.findById(id);
        if (!existing) throw new NotFound(`No item found with ${this.partitionKey} = ${String(id)}`);
        this._txItems.push({
          Delete: {
            TableName: this.tableName,
            Key: this.buildKey(id),
            ConditionExpression: `attribute_exists(${this.partitionKey})`,
          },
        });
        return existing;
      }

      const result = await this.client.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: this.buildKey(id),
          ConditionExpression: `attribute_exists(${this.partitionKey})`,
          ReturnValues: "ALL_OLD",
        }),
      );

      if (!result.Attributes) {
        throw new NotFound(`No item found with ${this.partitionKey} = ${String(id)}`);
      }

      return this.fromItem(result.Attributes as Record<string, AttributeValue>);
    } catch (err) {
      if (err instanceof NotFound) throw err;
      if (this.isConditionalCheckFailed(err)) {
        throw new NotFound(`No item found with ${this.partitionKey} = ${String(id)}`);
      }
      throw this.wrapError(err);
    }
  }

  async count(params?: QueryParams): Promise<number> {
    try {
      const where = params?.where as WhereClause | undefined;
      let filterExpression: string | undefined;
      let expressionNames: Record<string, string> | undefined;
      let expressionValues: Record<string, AttributeValue> | undefined;

      if (where) {
        const built = dynamodbify(where);
        filterExpression = built.expression || undefined;
        if (filterExpression) {
          expressionNames = Object.keys(built.names).length > 0 ? built.names : undefined;
          expressionValues = Object.keys(built.values).length > 0 ? built.values : undefined;
        }
      }

      let total = 0;
      let lastKey: Record<string, AttributeValue> | undefined;

      do {
        const result = await this.client.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: filterExpression,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            Select: "COUNT",
            ExclusiveStartKey: lastKey,
          }),
        );
        total += result.Count ?? 0;
        lastKey = result.LastEvaluatedKey as Record<string, AttributeValue> | undefined;
      } while (lastKey);

      return total;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ─── Transactions ─────────────────────────────────────────────────────────

  /**
   * Execute a set of repository write operations atomically via DynamoDB TransactWriteItems.
   * Supports up to 100 write operations per transaction.
   *
   * Note: in transaction mode, mutation methods (save, updateById, patchById, deleteById)
   * return the input data immediately rather than the persisted item, since
   * TransactWriteItems does not support ReturnValues.
   */
  async withTransaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    const txItems: TransactWriteItem[] = [];
    const copy = Object.create(this) as this;
    (copy as unknown as Record<string, unknown>)["_txItems"] = txItems;

    const result = await callback(copy);

    if (txItems.length > 100) {
      throw new GeneralError(`DynamoDB TransactWriteItems limit exceeded: ${txItems.length} items (max 100)`);
    }

    if (txItems.length > 0) {
      try {
        await this.client.send(new TransactWriteItemsCommand({ TransactItems: txItems }));
      } catch (err) {
        throw this.wrapError(err);
      }
    }

    return result;
  }

  // ─── Error handling ───────────────────────────────────────────────────────

  private isConditionalCheckFailed(err: unknown): boolean {
    const name = (err as { name?: string }).name ?? "";
    const code = (err as { code?: string }).code ?? "";
    return name === "ConditionalCheckFailedException" || code === "ConditionalCheckFailedException";
  }

  protected wrapError(err: unknown): Error {
    if (!(err instanceof Error)) return new GeneralError("An unknown DynamoDB error occurred");
    const name = (err as { name?: string }).name ?? "";
    const code = (err as { code?: string }).code ?? "";
    const errorId = name || code;

    switch (errorId) {
      case "ResourceNotFoundException":
        return new NotFound(err.message);
      case "ConditionalCheckFailedException":
        return new NotFound(err.message);
      case "ProvisionedThroughputExceededException":
      case "RequestLimitExceeded":
      case "ServiceUnavailable":
        return new Unavailable(err.message);
      case "AccessDeniedException":
      case "UnauthorizedException":
        return new Forbidden(err.message);
      case "ValidationException":
        return new BadRequest(err.message);
      case "TransactionConflictException":
      case "TransactionCanceledException":
        return new Conflict(err.message);
      default:
        return new GeneralError(err.message);
    }
  }

  // ─── Private utilities ────────────────────────────────────────────────────

  private extractId(id: Id): unknown {
    if (typeof id === "object" && id !== null) {
      return (id as Record<string, unknown>)["pk"];
    }
    return id;
  }
}
