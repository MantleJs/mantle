import { HttpVerb } from "@mantlejs/common";
import { ProtocolType, ServiceFunction } from "@mantlejs/mantle";
import { MantleExpress } from "./express";
import { rest, RestServiceFunction, ServiceMethod } from "./rest";

describe("rest", () => {
  describe("when the rest provider is configured", () => {
    let app: MantleExpress;
    beforeEach(() => {
      app = ({
        protocols: jest.fn(),
      } as unknown) as MantleExpress;
      rest()(app);
    });
    it("should set the REST HTTP protocol provider on the app", () => {
      expect(app.protocols).toBeCalledWith({ style: "REST", type: ProtocolType.HTTP, fn: expect.any(Function) });
    });
  });
  describe("method", () => {
    describe.each(ServiceMethod.values.map((method) => [`${method}SomeResource`, method]))("when service fn name is %s", (fnName, method) => {
      let app: MantleExpress;
      let service: RestServiceFunction;
      const operationId = fnName;

      beforeEach(() => {
        app = createFakeApp();
        service = createFakeService({ fnName, operationId });
        rest()(app);
        callProvider(app, service);
      });
      it(`should set the service.method property to ${method}`, () => {
        expect(service.method).toEqual(method);
      });
    });

    // it("should throw an exception when the method property in the definition argument is not a valid verb", () => {
    //   expect(
    //     () =>
    //       ApplicationService(app, {
    //         fn: getService,
    //         hooks,
    //         method: "notvalidmethod" as ServiceMethod,
    //       }).method,
    //   ).toThrow(new Error("The service definition method is invalid. The method property or the first verb in the service name or operation Id must be a valid ServiceMethod."));
    // });

    // it("should throw an exception when the method property is not set and cannot determine valid method from fn.name and id properties of the definition argument", () => {
    //   expect(
    //     () =>
    //       ApplicationService(app, {
    //         fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
    //         hooks,
    //       }).method,
    //   ).toThrow(new Error("The service definition method is invalid. The method property or the first verb in the service name or operation Id must be a valid ServiceMethod."));
    // });

    // it("should be set to the verb parsed from the fn.name in the definition argument when no method property is provided and the verb is a valid service method", () => {
    //   expect(
    //     ApplicationService(app, {
    //       fn: getService,
    //       hooks,
    //     }).method,
    //   ).toEqual("get");
    // });
    // it("should be set to the verb parsed from the id in the definition argument when no method property is provided, the fn.name is not valid and the verb is a valid service method", () => {
    //   expect(
    //     ApplicationService(app, {
    //       id: "getSomething",
    //       fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
    //       hooks,
    //     }).method,
    //   ).toEqual("get");
    // });
  });
  // describe("resource", () => {
  //   it("should be set to the resource property as-is from the service definition argument", () => {
  //     expect(
  //       ApplicationService(app, {
  //         fn: getService,
  //         // path,
  //         hooks,
  //         resource: "resource",
  //       }).resource,
  //     ).toEqual("resource");
  //   });
  //   it("should be set to the pluralized subject parsed from the fn.name property of the service definition argument", () => {
  //     expect(
  //       ApplicationService(app, {
  //         fn: getService,
  //         hooks,
  //         method,
  //       }).resource,
  //     ).toEqual("services");
  //   });
  //   it("should be set to the pluralized subject parsed from the operationId property of the service definition argument", () => {
  //     expect(
  //       ApplicationService(app, {
  //         fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
  //         id: "getOperation",
  //         hooks,
  //         method,
  //       }).resource,
  //     ).toEqual("operations");
  //   });
  //   it("should throw exeption when no resource given or one cannot be determined by the function name or ID", () => {
  //     expect(
  //       () =>
  //         ApplicationService(app, {
  //           fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
  //           hooks,
  //           method,
  //         }).resource,
  //     ).toThrowError("The service definition resource is invalid. A resource is required when no named fn service or no operation Id properties are provided.");
  //   });
  // });
});

function createFakeApp() {
  return ({
    route: jest.fn(() =>
      HttpVerb.values.reduce((acc, method) => {
        return {
          [method]: jest.fn(),
          ...acc,
        };
      }, {}),
    ),
    protocols: jest.fn(),
  } as unknown) as MantleExpress;
}

function createFakeService({ fnName, operationId }: { fnName: string; operationId: string }) {
  const service = (jest.fn() as unknown) as RestServiceFunction;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  service.fn = ({ [fnName]: () => {} }[fnName] as unknown) as ServiceFunction;
  service.operationId = operationId;
  return service;
}

function getProvider(app: MantleExpress) {
  return ((app.protocols as unknown) as jest.SpyInstance).mock.calls[0][0].fn;
}

function callProvider(app: MantleExpress, service: RestServiceFunction) {
  const provider = getProvider(app);
  provider(app, service);
}
