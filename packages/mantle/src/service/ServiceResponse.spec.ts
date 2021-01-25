import { ServiceResponse, ServiceResponseType } from "./index";

describe("ServiceResponse", () => {
  describe("constructor", () => {
    it("should set the frozen property to false and allow properties to be changed when freeze argument is false", () => {
      const svcErr = new ServiceResponse({}, false);
      svcErr.type = ServiceResponseType.UNKNOWN;
      expect(svcErr.frozen).toEqual(false);
    });
    it("should set the frozen property to true and NOT allow properties to be changed when freeze argument is true", () => {
      const svcErr = new ServiceResponse({}, true);
      expect(() => (svcErr.type = ServiceResponseType.UNKNOWN)).toThrow();
      expect(svcErr.frozen).toEqual(true);
    });
    it("should default to frozen when the freeze argument is not passed", () => {
      const svcErr = new ServiceResponse({});
      expect(() => (svcErr.type = ServiceResponseType.UNKNOWN)).toThrow();
      expect(svcErr.frozen).toEqual(true);
    });
    it("should not blow up when the constructor is not passed anything", () => {
      expect(new ServiceResponse()).toBeDefined();
    });
    it("should create a ServiceResponse with the type set to the type argument", () => {
      expect(new ServiceResponse({ type: ServiceResponseType.ACCEPTED }).type).toBe(ServiceResponseType.ACCEPTED);
    });
    it("should create a ServiceResponse with the payload set to the payload argument", () => {
      expect(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: "My Payload" }).payload).toBe("My Payload");
    });
    it("should create a ServiceResponse with the type set to ServiceResponseType.UNKNOWN when there is no type argument", () => {
      expect(new ServiceResponse({ payload: "My Payload" }).type).toBe(ServiceResponseType.UNKNOWN);
    });
  });
  describe("success", () => {
    it(`should return true if ServiceResponse is a success ServiceResponseType ${ServiceResponseType.SUCCESS}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.SUCCESS }).success).toBe(true);
    });
    it(`should return true if ServiceResponse is a success ServiceResponseType ${ServiceResponseType.ACCEPTED}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.ACCEPTED }).success).toBe(true);
    });
    it(`should return false if ServiceResponse is NOT a success ServiceResponseType ${ServiceResponseType.ERROR}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.ERROR }).success).toBe(false);
    });
    it(`should return false if ServiceResponse is NOT a success ServiceResponseType ${ServiceResponseType.UNKNOWN}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.UNKNOWN }).success).toBe(false);
    });
  });
});
