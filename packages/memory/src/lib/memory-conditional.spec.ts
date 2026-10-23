import { describe, expect, it } from "vitest";
import type { HookContext, HttpResponseMeta, Id } from "@mantlejs/mantle";
import { conditional, mantle, PreconditionFailed, RepositoryService } from "@mantlejs/mantle";
import { MemoryRepository } from "./memory-repository.js";

interface Doc extends Record<string, unknown> {
  id: string;
  title: string;
  version: number;
}

describe("MemoryRepository — WriteOptions.where", () => {
  it("applies a write whose precondition holds", async () => {
    const repo = new MemoryRepository<Doc>({ timestamps: false }).seed([{ id: "d1", title: "A", version: 1 }]);
    await expect(repo.patchById("d1", { title: "B" }, { where: { version: 1 } })).resolves.toMatchObject({
      title: "B",
    });
  });

  it.each(["updateById", "patchById", "deleteById"] as const)(
    "%s throws PreconditionFailed and leaves the record when the precondition fails",
    async (method) => {
      const repo = new MemoryRepository<Doc>({ timestamps: false }).seed([{ id: "d1", title: "A", version: 2 }]);
      const options = { where: { version: 1 } };
      const attempt =
        method === "deleteById" ? repo.deleteById("d1", options) : repo[method]("d1", { title: "B" }, options);
      await expect(attempt).rejects.toBeInstanceOf(PreconditionFailed);
      await expect(repo.findById("d1")).resolves.toMatchObject({ title: "A", version: 2 });
    },
  );
});

describe("conditional() over RepositoryService<MemoryRepository>", () => {
  function setup(versionField?: string) {
    const repo = new MemoryRepository<Doc>({ timestamps: false }).seed([{ id: "d1", title: "A", version: 1 }]);
    const app = mantle();
    app.use("docs", new RepositoryService<Doc>(repo));
    const etags = conditional({ versionField });
    // Simulates another writer landing between the If-Match check and this write. Only on the patch itself: the
    // check reads the record through the get pipeline, and a race there would just fail the check instead.
    const concurrentWrite = async (context: HookContext) => {
      if (context.method === "patch" && context.params.headers?.["x-race"]) {
        await repo.patchById("d1", { title: "Theirs", version: 2 });
      }
      return context;
    };
    app.service("docs").hooks({
      before: { all: [etags.before, concurrentWrite] },
      after: { all: [etags.after] },
    });
    const call = async (method: string, id: Id, headers: Record<string, string>, data?: Partial<Doc>) => {
      const response: HttpResponseMeta = {};
      const result = await app
        .service<Doc>("docs")
        .dispatch(method, data, id, { provider: "rest", headers }, { response });
      return { result, response };
    };
    return { repo, call };
  }

  it("with versionField, a write racing a concurrent change fails atomically instead of overwriting it", async () => {
    const { repo, call } = setup("version");
    const etag = (await call("get", "d1", {})).response.headers?.["ETag"] as string;
    const error = await call("patch", "d1", { "if-match": etag, "x-race": "1" }, { title: "Mine" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PreconditionFailed);
    // Rejected by the repository's conditional write, not by the hook's earlier check.
    expect((error as Error).message).toMatch(/no longer matches the write's precondition/);
    await expect(repo.findById("d1")).resolves.toMatchObject({ title: "Theirs" });
  });

  it("without versionField, the same race is not caught — the documented window", async () => {
    const { repo, call } = setup();
    const etag = (await call("get", "d1", {})).response.headers?.["ETag"] as string;
    await call("patch", "d1", { "if-match": etag, "x-race": "1" }, { title: "Mine" });
    await expect(repo.findById("d1")).resolves.toMatchObject({ title: "Mine" });
  });

  it("a fresh If-Match after re-reading succeeds", async () => {
    const { call } = setup("version");
    const etag = (await call("get", "d1", {})).response.headers?.["ETag"] as string;
    const { result } = await call("patch", "d1", { "if-match": etag }, { title: "Mine", version: 2 });
    expect(result).toMatchObject({ title: "Mine", version: 2 });
  });
});
