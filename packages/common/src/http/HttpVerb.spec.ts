/* eslint-disable @typescript-eslint/ban-ts-comment */
import { HttpVerb } from "./HttpVerb";

describe("HttpVerb", () => {
  describe("includes", () => {
    it("it should return false when method is not included", () => {
      expect(HttpVerb.includes("notamethod")).toEqual(false);
    });
    it("it should return true when method is GET", () => {
      expect(HttpVerb.includes("GET")).toEqual(true);
    });
    it("it should return true when method is get", () => {
      expect(HttpVerb.includes("get")).toEqual(true);
    });
    it("should return false when it was not a string", () => {
      // @ts-ignore
      expect(HttpVerb.includes()).toEqual(false);
    });
  });
});
