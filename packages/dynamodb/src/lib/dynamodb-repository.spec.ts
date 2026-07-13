import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";
import { BadRequest, Conflict, Forbidden, GeneralError, NotFound, Unavailable } from "@mantlejs/mantle";
import { DynamoDbRepository } from "./dynamodb-repository.js";

// ─── Mock AWS SDK ─────────────────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-dynamodb")>();
  return {
    ...actual,
    DynamoDBClient: vi.fn(() => ({ send: mockSend })),
  };
});

vi.mock("@aws-sdk/util-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/util-dynamodb")>();
  return actual;
});

// ─── Test fixtures ────────────────────────────────────────────────────────────

interface User extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
}

class UserRepo extends DynamoDbRepository<User> {
  readonly tableName = "users";
  override readonly timestamps = false;
}

class UserRepoWithTimestamps extends DynamoDbRepository<User> {
  readonly tableName = "users";
}

function makeApp(): MantleApplication {
  const client = { send: mockSend };
  return {
    get: vi.fn().mockReturnValue(client),
    set: vi.fn().mockReturnThis(),
  } as unknown as MantleApplication;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DynamoDbRepository", () => {
  let app: MantleApplication;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  describe("constructor", () => {
    it("retrieves the DynamoDB client from app", () => {
      const repo = new UserRepo(app);
      expect(app.get).toHaveBeenCalledWith("dynamodb");
      expect(repo).toBeDefined();
    });

    it("defaults partitionKey to 'id'", () => {
      expect(new UserRepo(app).partitionKey).toBe("id");
    });

    it("defaults timestamps to true", () => {
      expect(new UserRepoWithTimestamps(app).timestamps).toBe(true);
    });
  });

  describe("findAll (Scan)", () => {
    it("scans the table and returns items", async () => {
      const rawItem = { id: { S: "1" }, name: { S: "Alice" }, email: { S: "alice@example.com" } };
      mockSend.mockResolvedValue({ Items: [rawItem], Count: 1, ScannedCount: 1 });

      const result = await new UserRepo(app).findAll();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: "1", name: "Alice", email: "alice@example.com" });
    });

    it("returns empty array when no items", async () => {
      mockSend.mockResolvedValue({ Items: [], Count: 0 });
      const result = await new UserRepo(app).findAll();
      expect(result).toEqual([]);
    });

    it("applies in-memory sort", async () => {
      const raw = [
        { id: { S: "2" }, name: { S: "Bob" }, email: { S: "bob@example.com" } },
        { id: { S: "1" }, name: { S: "Alice" }, email: { S: "alice@example.com" } },
      ];
      mockSend.mockResolvedValue({ Items: raw, Count: 2 });

      const result = await new UserRepo(app).findAll({ sort: { name: "asc" } });
      expect(result[0].name).toBe("Alice");
      expect(result[1].name).toBe("Bob");
    });

    it("paginates using skip", async () => {
      const raw = [
        { id: { S: "1" }, name: { S: "Alice" }, email: { S: "a@a.com" } },
        { id: { S: "2" }, name: { S: "Bob" }, email: { S: "b@b.com" } },
        { id: { S: "3" }, name: { S: "Carol" }, email: { S: "c@c.com" } },
      ];
      mockSend.mockResolvedValue({ Items: raw, Count: 3 });

      const result = await new UserRepo(app).findAll({ skip: 1, limit: 2 });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("2");
    });

    it("uses _startKey as ExclusiveStartKey for cursor pagination", async () => {
      const startKey = { id: { S: "last-page-id" } };
      mockSend.mockResolvedValue({ Items: [], Count: 0 });

      const repo = new UserRepo(app);
      await repo.findAll({ _startKey: startKey });

      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.ExclusiveStartKey).toEqual(startKey);
    });

    it("exposes lastKey after a paginated scan", async () => {
      const lastKey = { id: { S: "page-end" } };
      const raw = [{ id: { S: "1" }, name: { S: "Alice" }, email: { S: "a@a.com" } }];
      mockSend.mockResolvedValue({ Items: raw, Count: 1, LastEvaluatedKey: lastKey });

      const repo = new UserRepo(app);
      await repo.findAll({ limit: 1 });
      expect(repo.lastKey).toEqual(lastKey);
    });

    it("wraps errors as GeneralError", async () => {
      mockSend.mockRejectedValue(new Error("network error"));
      await expect(new UserRepo(app).findAll()).rejects.toBeInstanceOf(GeneralError);
    });

    it("sends a well-formed FilterExpression for a null filter", async () => {
      mockSend.mockResolvedValue({ Items: [], Count: 0 });

      await new UserRepo(app).findAll({ where: { deletedAt: null } });

      const input = mockSend.mock.calls[0][0].input;
      expect(input.FilterExpression).toMatch(/attribute_not_exists/);
      const referenced = (input.FilterExpression as string).match(/:[A-Za-z0-9_]+/g) ?? [];
      expect(referenced.length).toBeGreaterThan(0);
      for (const alias of referenced) {
        expect(input.ExpressionAttributeValues).toHaveProperty(alias);
      }
    });
  });

  describe("findById", () => {
    it("returns the item when found", async () => {
      const rawItem = { id: { S: "1" }, name: { S: "Alice" }, email: { S: "alice@example.com" } };
      mockSend.mockResolvedValue({ Item: rawItem });

      const result = await new UserRepo(app).findById("1");
      expect(result).toMatchObject({ id: "1", name: "Alice" });
    });

    it("returns null when item not found", async () => {
      mockSend.mockResolvedValue({ Item: undefined });
      const result = await new UserRepo(app).findById("999");
      expect(result).toBeNull();
    });

    it("wraps errors as GeneralError", async () => {
      mockSend.mockRejectedValue(new Error("timeout"));
      await expect(new UserRepo(app).findById("1")).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("save", () => {
    it("puts the item and returns it", async () => {
      mockSend.mockResolvedValue({});
      const result = await new UserRepo(app).save({ id: "1", name: "Alice", email: "a@a.com" });
      expect(result).toMatchObject({ id: "1", name: "Alice" });
    });

    it("auto-generates a UUID when no partition key is provided", async () => {
      mockSend.mockResolvedValue({});
      const result = await new UserRepo(app).save({ name: "Alice", email: "a@a.com" } as Partial<User>);
      expect(result).toHaveProperty("id");
      expect(typeof (result as Record<string, unknown>)["id"]).toBe("string");
      expect((result as Record<string, unknown>)["id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("adds createdAt and updatedAt when timestamps is true", async () => {
      mockSend.mockResolvedValue({});
      const result = await new UserRepoWithTimestamps(app).save({ id: "1", name: "Alice", email: "a@a.com" });
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("updatedAt");
    });

    it("does not add timestamps when timestamps is false", async () => {
      mockSend.mockResolvedValue({});
      const result = await new UserRepo(app).save({ id: "1", name: "Alice", email: "a@a.com" });
      expect(result).not.toHaveProperty("createdAt");
    });
  });

  describe("saveAll", () => {
    it("batch-writes items and returns them", async () => {
      mockSend.mockResolvedValue({ UnprocessedItems: {} });
      const items = [
        { id: "1", name: "Alice", email: "a@a.com" },
        { id: "2", name: "Bob", email: "b@b.com" },
      ];
      const result = await new UserRepo(app).saveAll(items);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: "1" });
    });

    it("auto-generates UUIDs for items without a partition key", async () => {
      mockSend.mockResolvedValue({ UnprocessedItems: {} });
      const result = await new UserRepo(app).saveAll([
        { name: "Alice", email: "a@a.com" } as Partial<User>,
        { name: "Bob", email: "b@b.com" } as Partial<User>,
      ]);
      expect((result[0] as Record<string, unknown>)["id"]).toBeTruthy();
      expect((result[1] as Record<string, unknown>)["id"]).toBeTruthy();
      expect((result[0] as Record<string, unknown>)["id"]).not.toBe((result[1] as Record<string, unknown>)["id"]);
    });

    it("stamps all items with the same timestamps", async () => {
      mockSend.mockResolvedValue({ UnprocessedItems: {} });
      const result = await new UserRepoWithTimestamps(app).saveAll([
        { id: "1", name: "Alice", email: "a@a.com" },
        { id: "2", name: "Bob", email: "b@b.com" },
      ]);
      expect(result[0]).toHaveProperty("createdAt");
      expect(result[0]["createdAt"]).toBe(result[1]["createdAt"]);
    });
  });

  describe("withTransaction", () => {
    it("buffers save operations and commits via TransactWriteItems", async () => {
      mockSend.mockResolvedValue({});
      const repo = new UserRepo(app);
      await repo.withTransaction(async (tx) => {
        await tx.save({ id: "1", name: "Alice", email: "a@a.com" });
        await tx.save({ id: "2", name: "Bob", email: "b@b.com" });
      });

      // One TransactWriteItems call
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0]).toHaveProperty("Put");
    });

    it("returns the callback result", async () => {
      mockSend.mockResolvedValue({});
      const repo = new UserRepo(app);
      const result = await repo.withTransaction(async (tx) => {
        return tx.save({ id: "1", name: "Alice", email: "a@a.com" });
      });
      expect(result).toMatchObject({ id: "1", name: "Alice" });
    });

    it("throws GeneralError when transaction exceeds 100 items", async () => {
      const repo = new UserRepo(app);
      await expect(
        repo.withTransaction(async (tx) => {
          for (let i = 0; i < 101; i++) {
            await tx.save({ id: String(i), name: `User${i}`, email: `u${i}@x.com` });
          }
        }),
      ).rejects.toBeInstanceOf(GeneralError);
    });

    it("does not call send when no writes are buffered", async () => {
      const repo = new UserRepo(app);
      await repo.withTransaction(async () => {
        // no writes
      });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("updateById", () => {
    it("updates and returns the item", async () => {
      const updatedAttrs = {
        id: { S: "1" },
        name: { S: "Alice Updated" },
        email: { S: "alice@example.com" },
      };
      mockSend.mockResolvedValue({ Attributes: updatedAttrs });

      const result = await new UserRepo(app).updateById("1", {
        id: "1",
        name: "Alice Updated",
        email: "alice@example.com",
      });
      expect(result).toMatchObject({ id: "1", name: "Alice Updated" });
    });

    it("throws NotFound when ConditionalCheckFailedException", async () => {
      const err = new Error("Condition failed");
      (err as { name: string }).name = "ConditionalCheckFailedException";
      mockSend.mockRejectedValue(err);

      await expect(
        new UserRepo(app).updateById("999", { id: "999", name: "X", email: "x@x.com" }),
      ).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("patchById", () => {
    it("partially updates and returns the item", async () => {
      const updatedAttrs = { id: { S: "1" }, name: { S: "Patched" }, email: { S: "a@a.com" } };
      mockSend.mockResolvedValue({ Attributes: updatedAttrs });

      const result = await new UserRepo(app).patchById("1", { name: "Patched" } as Partial<User>);
      expect(result).toMatchObject({ name: "Patched" });
    });

    it("filters out undefined values from patch", async () => {
      const updatedAttrs = { id: { S: "1" }, name: { S: "Alice" }, email: { S: "a@a.com" } };
      mockSend.mockResolvedValue({ Attributes: updatedAttrs });

      // Should not throw — undefined email should be stripped
      await expect(
        new UserRepo(app).patchById("1", { name: "Alice", email: undefined } as unknown as Partial<User>),
      ).resolves.toBeDefined();
    });

    it("throws NotFound when ConditionalCheckFailedException", async () => {
      const err = new Error("Condition failed");
      (err as { name: string }).name = "ConditionalCheckFailedException";
      mockSend.mockRejectedValue(err);

      await expect(new UserRepo(app).patchById("999", { name: "X" } as Partial<User>)).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("deleteById", () => {
    it("deletes and returns the item", async () => {
      const deletedAttrs = { id: { S: "1" }, name: { S: "Alice" }, email: { S: "a@a.com" } };
      mockSend.mockResolvedValue({ Attributes: deletedAttrs });

      const result = await new UserRepo(app).deleteById("1");
      expect(result).toMatchObject({ id: "1" });
    });

    it("throws NotFound when ConditionalCheckFailedException", async () => {
      const err = new Error("Condition failed");
      (err as { name: string }).name = "ConditionalCheckFailedException";
      mockSend.mockRejectedValue(err);

      await expect(new UserRepo(app).deleteById("999")).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("count", () => {
    it("returns the total count from Scan SELECT COUNT", async () => {
      mockSend.mockResolvedValue({ Count: 42, ScannedCount: 42 });
      const result = await new UserRepo(app).count();
      expect(result).toBe(42);
    });

    it("returns 0 when Count is undefined", async () => {
      mockSend.mockResolvedValue({});
      const result = await new UserRepo(app).count();
      expect(result).toBe(0);
    });

    it("accumulates count across paginated scans", async () => {
      mockSend
        .mockResolvedValueOnce({ Count: 100, ScannedCount: 100, LastEvaluatedKey: { id: { S: "100" } } })
        .mockResolvedValueOnce({ Count: 42, ScannedCount: 42 });

      const result = await new UserRepo(app).count();
      expect(result).toBe(142);
    });
  });

  describe("wrapError — DynamoDB error mapping", () => {
    async function throwsNamed(name: string) {
      mockSend.mockRejectedValue(Object.assign(new Error("db error"), { name }));
      return new UserRepo(app).findAll();
    }

    it("ResourceNotFoundException → NotFound", async () => {
      await expect(throwsNamed("ResourceNotFoundException")).rejects.toBeInstanceOf(NotFound);
    });

    it("ProvisionedThroughputExceededException → Unavailable", async () => {
      await expect(throwsNamed("ProvisionedThroughputExceededException")).rejects.toBeInstanceOf(Unavailable);
    });

    it("AccessDeniedException → Forbidden", async () => {
      await expect(throwsNamed("AccessDeniedException")).rejects.toBeInstanceOf(Forbidden);
    });

    it("ValidationException → BadRequest", async () => {
      await expect(throwsNamed("ValidationException")).rejects.toBeInstanceOf(BadRequest);
    });

    it("TransactionConflictException → Conflict", async () => {
      await expect(throwsNamed("TransactionConflictException")).rejects.toBeInstanceOf(Conflict);
    });

    it("unknown errors → GeneralError", async () => {
      await expect(throwsNamed("SomeUnknownException")).rejects.toBeInstanceOf(GeneralError);
    });

    it("non-Error throws → GeneralError", async () => {
      mockSend.mockRejectedValue("string error");
      await expect(new UserRepo(app).findAll()).rejects.toBeInstanceOf(GeneralError);
    });
  });
});
