import { StringUtil } from "./StringUtil";

describe("StringUtil", () => {
  describe("isStringEmptyUndefinedOrNull", () => {
    it("should return true when the value is null", () => {
      expect(StringUtil.isStringEmptyUndefinedOrNull(null)).toEqual(true);
    });
    it("should return true when the value is undefined", () => {
      expect(StringUtil.isStringEmptyUndefinedOrNull(undefined)).toEqual(true);
    });
    it("should return true when the value is empty string", () => {
      expect(StringUtil.isStringEmptyUndefinedOrNull("")).toEqual(true);
    });
    it("should return false when the value is NOT a empty string", () => {
      expect(StringUtil.isStringEmptyUndefinedOrNull("dafd")).toEqual(false);
    });
  });
  describe("splice", () => {
    it("should splice the value at the given index when index is a positive integer within the length of the string", () => {
      expect(StringUtil.splice("abcdefghijklmnop", 4, 3, "12345")).toEqual("abcd12345hijklmnop");
    });
    it("should splice the value at the given negative index when index is a negative integer within the length of the string", () => {
      expect(StringUtil.splice("abcdefghijklmnop", -4, 2, "12345")).toEqual("abcdefghijkl12345op");
    });
    it("should splice the value at 0 when index is a negative integer that results in a negative start index", () => {
      expect(StringUtil.splice("abcdefghijklmnop", -18, 5, "12345")).toEqual("12345fghijklmnop");
    });
    it("should remove only the count value when value is undefined", () => {
      expect(StringUtil.splice("abcdefghijklmnop", 4, 3, undefined)).toEqual("abcdhijklmnop");
    });
  });
});
