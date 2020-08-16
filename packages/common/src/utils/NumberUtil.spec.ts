import { NumberUtil } from "./NumberUtil";

describe("NumberUtil", () => {
  describe("tryParseInt", () => {
    it("should convert the string value to a number when the string can be converted to a number", () => {
      expect(NumberUtil.tryParseInt("-33")).toBe(-33);
    });
    it("should given value when the given value is a number", () => {
      expect(NumberUtil.tryParseInt(22)).toBe(22);
    });
    it("should return the default value when the value is undefined", () => {
      expect(NumberUtil.tryParseInt(undefined, 2)).toBe(2);
    });
    it("should return the default value when the value is empty string", () => {
      expect(NumberUtil.tryParseInt("", 2)).toBe(2);
    });
  });
});
