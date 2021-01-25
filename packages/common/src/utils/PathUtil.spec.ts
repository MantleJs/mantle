import { PathUtil } from "./PathUtil";

describe("PathUtil", () => {
  describe("trimeSlashes", () => {
    it("should return trailing slashes in path", () => {
      expect(PathUtil.trimSlashes("/a/b/c/")).toEqual("a/b/c");
    });
  });
});
