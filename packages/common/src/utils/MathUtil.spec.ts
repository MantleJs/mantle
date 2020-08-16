import { MathUtil } from "./MathUtil";

describe("MathUtil", () => {
  describe("getRandomInteger", () => {
    it("should return a random number between 0 and the maximum positive integer", () => {
      expect(MathUtil.getRandomInteger(23)).toBeLessThan(23);
    });
  });
});
