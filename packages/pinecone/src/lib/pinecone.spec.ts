import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";

vi.mock("@pinecone-database/pinecone", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Pinecone: vi.fn().mockImplementation(function (this: any) {
    this.index = vi.fn();
  }),
  Index: vi.fn(),
}));

describe("pinecone plugin", () => {
  let app: MantleApplication;

  beforeEach(() => {
    app = { set: vi.fn().mockReturnThis(), get: vi.fn() } as unknown as MantleApplication;
  });

  it("stores the Pinecone client as 'pinecone' on the app", async () => {
    const { pinecone } = await import("./pinecone.js");
    const { Pinecone } = await import("@pinecone-database/pinecone");
    pinecone({ apiKey: "test-key" })(app);
    const [key, value] = (app.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(key).toBe("pinecone");
    expect(value).toBeInstanceOf(Pinecone);
  });

  it("passes apiKey to the Pinecone constructor", async () => {
    const { pinecone } = await import("./pinecone.js");
    const { Pinecone } = await import("@pinecone-database/pinecone");
    pinecone({ apiKey: "my-secret-key" })(app);
    expect(Pinecone).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "my-secret-key" }));
  });

  it("works with no config (apiKey from PINECONE_API_KEY env var)", async () => {
    const { pinecone } = await import("./pinecone.js");
    expect(() => pinecone()(app)).not.toThrow();
    expect(app.set).toHaveBeenCalledWith("pinecone", expect.any(Object));
  });
});
