import { conditional, entityTag, matchesIfMatch, matchesIfNoneMatch } from "./conditional.js";
import { NotFound, PreconditionFailed } from "./errors.js";
import { mantle } from "./mantle.js";
import type { HttpResponseMeta, Id, ServiceParams, WriteOptions } from "./types.js";

interface Article {
  id: string;
  title: string;
  version: number;
}

/** A tiny service over a Map that records the precondition each write received. */
function makeApp(options: Parameters<typeof conditional>[0] = {}) {
  const store = new Map<string, Article>([["a1", { id: "a1", title: "Hello", version: 1 }]]);
  const preconditions: Array<WriteOptions | undefined> = [];
  const app = mantle();
  app.use<Article>("articles", {
    async get(id: Id) {
      const record = store.get(String(id));
      if (!record) throw new NotFound();
      return record;
    },
    async patch(id: Id, data: Partial<Article>, params?: ServiceParams) {
      preconditions.push(params?.precondition);
      const next = { ...(store.get(String(id)) as Article), ...data };
      store.set(String(id), next);
      return next;
    },
    async remove(id: Id, params?: ServiceParams) {
      preconditions.push(params?.precondition);
      const record = store.get(String(id)) as Article;
      store.delete(String(id));
      return record;
    },
  });
  const etags = conditional(options);
  app.service("articles").hooks({ before: { all: [etags.before] }, after: { all: [etags.after] } });
  const call = async (method: string, id: Id, headers: Record<string, string> = {}, data?: Partial<Article>) => {
    const response: HttpResponseMeta = {};
    const result = await app
      .service<Article>("articles")
      .dispatch(method, data, id, { provider: "rest", headers }, { response });
    return { result, response };
  };
  return { store, preconditions, call };
}

describe("entityTag", () => {
  it("is a strong, quoted hash of the record that ignores key order", () => {
    const tag = entityTag({ a: 1, b: { c: 2, d: 3 } });
    expect(tag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect(entityTag({ b: { d: 3, c: 2 }, a: 1 })).toBe(tag);
    expect(entityTag({ a: 2, b: { c: 2, d: 3 } })).not.toBe(tag);
  });

  it("uses the version field verbatim when it's ETag-safe", () => {
    expect(entityTag({ version: 7 }, "version")).toBe('"7"');
    expect(entityTag({ updatedAt: new Date("2026-10-22T10:00:00.000Z") }, "updatedAt")).toBe(
      '"2026-10-22T10:00:00.000Z"',
    );
  });

  it("hashes a version value with characters an ETag can't hold", () => {
    expect(entityTag({ version: 'a "b"' }, "version")).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
  });

  it("falls back to the hash when the record lacks the version field", () => {
    expect(entityTag({ id: 1 }, "version")).toBe(entityTag({ id: 1 }));
  });
});

describe("If-Match / If-None-Match comparison", () => {
  it("If-None-Match compares weakly and accepts lists and *", () => {
    expect(matchesIfNoneMatch('"x"', '"x"')).toBe(true);
    expect(matchesIfNoneMatch('W/"x"', '"x"')).toBe(true);
    expect(matchesIfNoneMatch('"a", W/"x"', '"x"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"x"')).toBe(true);
    expect(matchesIfNoneMatch('"y"', '"x"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"x"')).toBe(false);
  });

  it("If-Match compares strongly: a weak tag never matches", () => {
    expect(matchesIfMatch('"x"', '"x"')).toBe(true);
    expect(matchesIfMatch('"a", "x"', '"x"')).toBe(true);
    expect(matchesIfMatch("*", '"x"')).toBe(true);
    expect(matchesIfMatch('W/"x"', '"x"')).toBe(false);
    expect(matchesIfMatch('"y"', '"x"')).toBe(false);
  });

  it("handles a comma inside an entity tag", () => {
    expect(matchesIfMatch('"a,b"', '"a,b"')).toBe(true);
  });
});

describe("conditional() — get", () => {
  it("sets a strong ETag", async () => {
    const { call } = makeApp();
    const { response } = await call("get", "a1");
    expect(response.headers?.["ETag"]).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect(response.status).toBeUndefined();
  });

  it("answers a matching If-None-Match with 304 and the ETag", async () => {
    const { call } = makeApp();
    const { response: first } = await call("get", "a1");
    const etag = first.headers?.["ETag"] as string;
    const { response } = await call("get", "a1", { "if-none-match": `W/${etag}` });
    expect(response).toEqual({ status: 304, headers: { ETag: etag } });
  });

  it("answers a stale If-None-Match normally", async () => {
    const { call } = makeApp();
    const { response } = await call("get", "a1", { "if-none-match": '"stale"' });
    expect(response.status).toBeUndefined();
  });
});

describe("conditional() — writes", () => {
  it("passes a write without If-Match through, unchecked", async () => {
    const { call, preconditions } = makeApp({ versionField: "version" });
    await call("patch", "a1", {}, { title: "Edited" });
    expect(preconditions).toEqual([undefined]);
  });

  it("applies a write whose If-Match matches, and returns the new ETag", async () => {
    const { call, store } = makeApp();
    const etag = (await call("get", "a1")).response.headers?.["ETag"] as string;
    const { result, response } = await call("patch", "a1", { "if-match": etag }, { title: "Edited" });
    expect(result).toMatchObject({ title: "Edited" });
    expect(store.get("a1")?.title).toBe("Edited");
    expect(response.headers?.["ETag"]).not.toBe(etag);
  });

  it("rejects a write whose If-Match is stale with PreconditionFailed, leaving the record alone", async () => {
    const { call, store } = makeApp();
    await expect(call("patch", "a1", { "if-match": '"stale"' }, { title: "Edited" })).rejects.toBeInstanceOf(
      PreconditionFailed,
    );
    expect(store.get("a1")?.title).toBe("Hello");
  });

  it("rejects a weak If-Match even when its tag matches", async () => {
    const { call } = makeApp();
    const etag = (await call("get", "a1")).response.headers?.["ETag"] as string;
    await expect(call("remove", "a1", { "if-match": `W/${etag}` })).rejects.toBeInstanceOf(PreconditionFailed);
  });

  it("accepts If-Match: * for an existing record", async () => {
    const { call, store } = makeApp();
    await call("remove", "a1", { "if-match": "*" });
    expect(store.has("a1")).toBe(false);
  });

  it("returns NotFound, not 412, for a missing record", async () => {
    const { call } = makeApp();
    await expect(call("patch", "nope", { "if-match": '"x"' }, { title: "x" })).rejects.toBeInstanceOf(NotFound);
  });

  it("with versionField, matches on the version and hands the write a precondition on it", async () => {
    const { call, preconditions } = makeApp({ versionField: "version" });
    const { response } = await call("get", "a1");
    expect(response.headers?.["ETag"]).toBe('"1"');
    await call("patch", "a1", { "if-match": '"1"' }, { title: "Edited", version: 2 });
    expect(preconditions).toEqual([{ where: { version: 1 } }]);
  });

  it("with requireIfMatch, rejects a write without If-Match with a hint", async () => {
    const { call, store } = makeApp({ requireIfMatch: true });
    const error = await call("remove", "a1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreconditionFailed);
    expect((error as PreconditionFailed).hint).toMatch(/If-Match/);
    expect(store.has("a1")).toBe(true);
  });

  it("doesn't require If-Match on reads with requireIfMatch", async () => {
    const { call } = makeApp({ requireIfMatch: true });
    await expect(call("get", "a1")).resolves.toBeDefined();
  });
});
