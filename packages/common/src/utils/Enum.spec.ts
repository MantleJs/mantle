import { Enum } from "./Enum";

describe("Enum", () => {
  enum BitFlag {
    BIT0 = 1 << 0,
    BIT1 = 1 << 1,
    BIT2 = 1 << 2,
  }
  describe("hasValue", () => {
    it("should return true when the enum type has the given value", () => {
      expect(Enum.hasValue(BitFlag, 1 << 0)).toBe(true);
    });
    it("should return false when the enum type does NOT have the given value", () => {
      expect(Enum.hasValue(BitFlag, 3 << 0)).toBe(false);
    });
  });
  describe("getKeys", () => {
    it("should return the expected enum keys", () => {
      expect(Enum.getKeys(BitFlag)).toEqual(["BIT0", "BIT1", "BIT2"]);
    });
  });
});
