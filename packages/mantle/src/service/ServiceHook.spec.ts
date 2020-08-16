/* eslint-disable @typescript-eslint/no-unused-vars */
import { ServiceHook, ServiceResponseType, ServiceRequest, ServiceResponse } from "./index";
import * as R from "ramda";

describe("ServiceHook", () => {
  it("should set the hook function name to the original function name", () => {
    const getSomethingGood = (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: "Something good" }));
    const hooks = { before: () => Promise.resolve(), after: () => Promise.resolve() };
    const hooks2 = { before: () => Promise.resolve(), after: () => Promise.resolve() };
    const Hook = ServiceHook<ServiceResponseType>(hooks)(getSomethingGood);
    const Hook2 = ServiceHook(hooks2)(Hook);
    const piped = R.pipe(ServiceHook(hooks), ServiceHook(hooks2))(getSomethingGood);
    const obj = { piped };
    expect(Hook.name).toBe("getSomethingGood");
    expect(Hook2.name).toBe("getSomethingGood");
    expect(piped.name).toBe("getSomethingGood");
    expect(obj.piped.name).toBe("getSomethingGood");
  });
  describe("when a before hook modifies the request and returns it", () => {
    const request = createFakeRequest();
    const modifiedRequest = { ...request, p3: "p3" };
    const hooks = { before: jest.fn(({ request }) => Promise.resolve({ ...request, p3: "p3" })) };
    const expectedResponse = new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: modifiedRequest });
    const fn = jest.fn((request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: request })));

    let response: ServiceResponse;

    beforeAll(async () => {
      response = await ServiceHook(hooks)(fn)(request);
    });

    it("should call before hook before calling the original function", () => {
      expect(hooks.before.mock.invocationCallOrder[0]).toBeLessThan(fn.mock.invocationCallOrder[0]);
    });
    it("should call before hook with the given service request argument", () => {
      expect(hooks.before).toBeCalledWith({ request });
    });
    it("should call original function with the service request argument modified by the before hook", () => {
      expect(fn).toBeCalledWith(modifiedRequest);
    });
    it("should return the expected response from the orginial function", () => {
      expect(response).toStrictEqual(expectedResponse);
    });
  });
  describe("when a before hook does not modify the request and returns undefined", () => {
    const request = createFakeRequest();
    const hooks = { before: jest.fn(() => Promise.resolve(undefined)) };
    const expectedResponse = new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: request });
    const fn = jest.fn((request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: request })));

    let response: ServiceResponse;

    beforeAll(async () => {
      response = await ServiceHook(hooks)(fn)(request);
    });

    it("should call before hook before calling the original function", () => {
      expect(hooks.before.mock.invocationCallOrder[0]).toBeLessThan(fn.mock.invocationCallOrder[0]);
    });
    it("should call before hook with the given service request argument", () => {
      expect(hooks.before).toBeCalledWith({ request });
    });
    it("should call original function with the service request argument unmodified by the before hook", () => {
      expect(fn).toBeCalledWith(request);
    });
    it("should return the expected response from the orginial function", () => {
      expect(response).toStrictEqual(expectedResponse);
    });
  });
  describe("when a after hook modifies the response and returns it", () => {
    const request = createFakeRequest();
    const hooks = { after: jest.fn(({ response }) => Promise.resolve(new ServiceResponse({ ...response, payload: { ...response.payload, p3: "p3" } }))) };
    const expectedResponse = new ServiceResponse({ type: ServiceResponseType.SUCCESS, success: true, payload: { ...request, p3: "p3" } });
    const originalResponse = new ServiceResponse({ type: ServiceResponseType.SUCCESS, success: true, payload: request });
    const fn = jest.fn((request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: request })));

    let response: ServiceResponse;

    beforeAll(async () => {
      response = await ServiceHook(hooks)(fn)(request);
    });

    it("should call after hook after calling the original function", () => {
      expect(hooks.after.mock.invocationCallOrder[0]).toBeGreaterThan(fn.mock.invocationCallOrder[0]);
    });
    it("should call after hook with the service request and a response property with the original service response", () => {
      expect(hooks.after).toBeCalledWith({ request, response: originalResponse });
    });
    it("should call original function with the service request argument modified by the before hook", () => {
      expect(fn).toBeCalledWith(request);
    });
    it("should return the modifiedResponse response from the after hook", () => {
      expect(response).toStrictEqual(expectedResponse);
    });
  });
  describe("when a after hook does not modify the response and returns undefined", () => {
    const request = createFakeRequest();
    const hooks = { after: jest.fn(() => Promise.resolve(undefined)) };
    const orginalResponse = { type: ServiceResponseType.SUCCESS, success: true, payload: request };
    const fn = jest.fn((request: ServiceRequest) => Promise.resolve({ type: ServiceResponseType.SUCCESS, success: true, payload: request } as ServiceResponse));

    let response: ServiceResponse;

    beforeAll(async () => {
      response = await ServiceHook(hooks)(fn)(request);
    });

    it("should call after hook after calling the original function", () => {
      expect(hooks.after.mock.invocationCallOrder[0]).toBeGreaterThan(fn.mock.invocationCallOrder[0]);
    });
    it("should call after hook with the service request and a response property with the original service response", () => {
      expect(hooks.after).toBeCalledWith({ request, response: orginalResponse });
    });
    it("should call original function with the service request argument modified by the before hook", () => {
      expect(fn).toBeCalledWith(request);
    });
    it("should return the modifiedResponse response from the after hook", () => {
      expect(response).toStrictEqual(orginalResponse);
    });
  });
  describe("when there is a request error", () => {
    const request = createFakeRequest();
    const error = new Error("Unexpected");
    const hooks = {
      before: jest.fn(({ request }) => {
        request.error = error;
        return Promise.resolve();
      }),
      error: jest.fn(() => Promise.resolve(undefined)),
    };
    const expectedResponse = new ServiceResponse({ type: ServiceResponseType.ERROR, payload: error });
    const fn = jest.fn((request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: request })));

    let response: ServiceResponse;

    beforeAll(async () => {
      response = await ServiceHook(hooks)(fn)(request);
    });
    it("should call the error hook handler with the request and error response created from the exception thrown", () => {
      expect(hooks.error).toBeCalledWith({ request, response: expectedResponse });
    });
    it("should return an error response", () => {
      expect(response).toStrictEqual(expectedResponse);
    });
  });
  describe("when an unexpected error exception is thrown", () => {
    const request = createFakeRequest();
    const error = new Error("Unexpected");
    const hooks = { after: jest.fn(() => Promise.resolve(undefined)), error: jest.fn(() => Promise.resolve(undefined)) };
    const expectedResponse = new ServiceResponse({ type: ServiceResponseType.ERROR, payload: error });
    const fn = jest.fn(
      (request: ServiceRequest): Promise<ServiceResponse> => {
        throw error;
      },
    );

    let response: ServiceResponse;

    beforeAll(async () => {
      response = await ServiceHook(hooks)(fn)(request);
    });

    it("should call the error hook handler with the request and error response created from the exception thrown", () => {
      expect(hooks.error).toBeCalledWith({ request, response: expectedResponse });
    });
    it("should return an error response", () => {
      expect(response).toStrictEqual(expectedResponse);
    });
  });
});

function createFakeRequest(): ServiceRequest {
  return new ServiceRequest({
    params: { p1: "p1" },
  });
}
