/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ServiceRequest } from "./index";
import { NumberArray } from "@mantlejs/common";

describe("ServiceRequest", () => {
  const request: ServiceRequest = new ServiceRequest({
    params: {
      strParam: "bobby",
      path: {
        to: {
          arrayParam: "mikey",
        },
      },
      numStrParam: "123",
      numStrArrayParam: ["1", "2", "3"],
    },
  });

  it("should create new ServiceRequest when no properties are provided in the constructor", () => {
    expect(new ServiceRequest()).toBeDefined();
  });

  describe("getParam", () => {
    it("should return the param when given the name of the param is a string and the param exists", () => {
      expect(request.getParam("strParam")).toBe("bobby");
    });
    it("should return the param when given the name of the param is an array path and the param exists", () => {
      expect(request.getParam(["path", "to", "arrayParam"])).toBe("mikey");
    });
    it("should return undefined when given the name of the param is a string and the param does not exists", () => {
      expect(request.getParam("notAParam")).toBeUndefined();
    });
    it("should return undefined when given the name of the param is an array path and the param does not exists", () => {
      expect(request.getParam(["not", "a", "param"])).toBeUndefined();
    });
    it("should return the param converted to number type when the param is a number string and Number type is given to the getParam", () => {
      expect(request.getParam("numStrParam", Number)).toBe(123);
    });
    it("should return the param converted to number array type when the param is a number string array and NumberArray type is given to the getParam", () => {
      expect(request.getParam("numStrArrayParam", NumberArray)).toEqual([1, 2, 3]);
    });
  });
  describe("getFirstParam", () => {
    it("should return the first param found from the array of param names", () => {
      expect(request.getFirstParam(["strParam1", "strParam2", "strParam", "strParam3"])).toBe("bobby");
    });
    it("should return the param when given the name of the param is an array of array path and the param exists", () => {
      expect(
        request.getFirstParam([
          ["path", "to", "nothing"],
          ["path", "to", "arrayParam"],
          ["path", "to", "nothing2"],
        ]),
      ).toBe("mikey");
    });
    it("should return undefined when given an array of param names and the param does not exists", () => {
      expect(request.getFirstParam(["notAParam", "notAParam2", "notAParam3"])).toBeUndefined();
    });
    it("should return undefined when given an array of array of param names and the param does not exists", () => {
      expect(request.getFirstParam([["notAParam"], ["notAParam2"], ["notAParam3"]])).toBeUndefined();
    });
    it("should return the param converted to number type when the param is a number string and Number type is given to the getParam", () => {
      expect(request.getFirstParam(["numStrParam", "something"], Number)).toBe(123);
    });
    it("should return the param converted to number array type when the param is a number string array and NumberArray type is given to the getParam", () => {
      expect(request.getFirstParam(["numStrArrayParam", "something", "nothing"], NumberArray)).toEqual([1, 2, 3]);
    });
  });
  describe("getParamAsNumber", () => {
    it("should get the param converted to a number", () => {
      expect(request.getParamAsNumber("numStrParam")).toEqual(123);
    });
  });
  describe("getParamAsNumberArray", () => {
    it("should get the param converted to a number", () => {
      expect(request.getParamAsNumberArray("numStrArrayParam")).toEqual([1, 2, 3]);
    });
  });
});
