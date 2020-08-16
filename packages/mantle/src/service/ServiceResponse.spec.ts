import { ServiceResponse, ServiceResponseType, SERVICE_RESPONSE_UNKNOWN_TYPE } from "./index";

describe("ServiceResponse", () => {
  describe("constructor", () => {
    it("should set the frozen property to false and allow properties to be changed when freeze argument is false", () => {
      const svcErr = new ServiceResponse({}, false);
      svcErr.type = SERVICE_RESPONSE_UNKNOWN_TYPE;
      expect(svcErr.frozen).toEqual(false);
    });
    it("should set the frozen property to true and NOT allow properties to be changed when freeze argument is true", () => {
      const svcErr = new ServiceResponse({}, true);
      expect(() => (svcErr.type = SERVICE_RESPONSE_UNKNOWN_TYPE)).toThrow();
      expect(svcErr.frozen).toEqual(true);
    });
    it("should default to frozen when the freeze argument is not passed", () => {
      const svcErr = new ServiceResponse({});
      expect(() => (svcErr.type = SERVICE_RESPONSE_UNKNOWN_TYPE)).toThrow();
      expect(svcErr.frozen).toEqual(true);
    });
    it("should not blow up when the constructor is not passed anything", () => {
      expect(new ServiceResponse()).toBeDefined();
    });
    it("should create a ServiceResponse with the type set to the type argument", () => {
      expect(new ServiceResponse({ type: ServiceResponseType.CREATED }).type).toBe(ServiceResponseType.CREATED);
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
    it(`should return true if ServiceResponse is a success ServiceResponseType ${ServiceResponseType.QUEUED}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.QUEUED }).success).toBe(true);
    });
    it(`should return true if ServiceResponse is a success ServiceResponseType ${ServiceResponseType.CREATED}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.CREATED }).success).toBe(true);
    });
    it(`should return false if ServiceResponse is NOT a success ServiceResponseType ${ServiceResponseType.ERROR}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.ERROR }).success).toBe(false);
    });
    it(`should return false if ServiceResponse is NOT a success ServiceResponseType ${ServiceResponseType.UNKNOWN}`, () => {
      expect(new ServiceResponse({ type: ServiceResponseType.UNKNOWN }).success).toBe(false);
    });
  });
});
