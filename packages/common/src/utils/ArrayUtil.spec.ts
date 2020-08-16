/* eslint-disable @typescript-eslint/ban-ts-ignore */
import { ArrayUtil, NumberArray } from "./ArrayUtil";

describe("ArrayUtil", () => {
  describe("sample", () => {
    const values = ["a", "b", "c", "d", "e"];
    it("should randomly choose a sample from the array", () => {
      expect(values).toContain(ArrayUtil.sample(values));
    });
  });
  describe("isNilOrEmpty", () => {
    it("should return true when the value is null", () => {
      expect(ArrayUtil.isNilOrEmpty(null)).toEqual(true);
    });
    it("should return true when the value is undefined", () => {
      expect(ArrayUtil.isNilOrEmpty(undefined)).toEqual(true);
    });
    it("should return true when the value is an empty array", () => {
      expect(ArrayUtil.isNilOrEmpty([])).toEqual(true);
    });
    it("should return false when the value is an array with items", () => {
      expect(ArrayUtil.isNilOrEmpty([1, 2, 3])).toEqual(false);
    });
  });
  describe("NumberArray", () => {
    it("should return the value passed when it is not an array", () => {
      //@ts-ignore
      expect(NumberArray("2")).toEqual("2");
    });
    it("should return the array of string numbers into an array of numbers", () => {
      expect(NumberArray(["1", "2", "3"])).toStrictEqual([1, 2, 3]);
    });
  });
});
