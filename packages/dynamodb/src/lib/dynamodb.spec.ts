import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";

// ─── Mock AWS SDK ─────────────────────────────────────────────────────────────

const mockDestroy = vi.fn();

vi.mock("@aws-sdk/client-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-dynamodb")>();
  class MockDynamoDBClient {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      mockConstruct(config);
    }
    destroy = mockDestroy;
  }
  return { ...actual, DynamoDBClient: MockDynamoDBClient };
});

const mockConstruct = vi.fn();

const { dynamodb } = await import("./dynamodb.js");

describe("dynamodb plugin", () => {
  let app: MantleApplication;
  let setValues: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    setValues = {};
    app = {
      set: vi.fn((key: string, value: unknown) => {
        setValues[key] = value;
        return app;
      }),
      get: vi.fn((key: string) => setValues[key]),
      teardown: vi.fn().mockResolvedValue(undefined),
    } as unknown as MantleApplication;
  });

  it("returns a MantlePlugin function", () => {
    const plugin = dynamodb({ region: "us-east-1" });
    expect(typeof plugin).toBe("function");
  });

  it("creates a DynamoDBClient and sets it on the app", () => {
    dynamodb({ region: "us-east-1" })(app);
    expect(mockConstruct).toHaveBeenCalledWith(expect.objectContaining({ region: "us-east-1" }));
    expect(app.set).toHaveBeenCalledWith("dynamodb", expect.objectContaining({ destroy: mockDestroy }));
  });

  it("supports clientConfig override", () => {
    dynamodb({ clientConfig: { region: "eu-west-1", endpoint: "http://localhost:8000" } })(app);
    expect(mockConstruct).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu-west-1", endpoint: "http://localhost:8000" }),
    );
  });

  it("works with no options (uses env vars / default config)", () => {
    dynamodb()(app);
    expect(mockConstruct).toHaveBeenCalledWith({});
    expect(app.set).toHaveBeenCalledWith("dynamodb", expect.anything());
  });

  it("wraps teardown to destroy the DynamoDB client", async () => {
    dynamodb({ region: "us-east-1" })(app);
    await app.teardown();
    expect(mockDestroy).toHaveBeenCalled();
  });
});
