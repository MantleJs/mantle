import { ApplicationService, Application } from "./index";
import { ServiceDefinition, ServiceMethod } from "./ApplicationService";
import { ServiceFunction, ServiceRequest, ServiceResponse, HookDefinition, ServiceHook, ServiceResponseType } from "../service";

describe("ApplicationService", () => {
  const app = new Application();
  const path = "/resources/to/something";
  const method: ServiceMethod = "get";
  const getService: ServiceFunction = (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` }));
  const hook1: HookDefinition = {
    before: ({ request }) => {
      request.data += `hook1 (param=${request.getParam(["a", "b"])}) => `;
      return Promise.resolve(request);
    },
    after: ({ response }) => {
      return Promise.resolve(new ServiceResponse({ ...response, payload: response.payload + " => hook1" }));
    },
  };
  const hook2: HookDefinition = {
    before: ({ request }) => {
      request.data += "hook2 => ";
      return Promise.resolve(request);
    },
    after: ({ response }) => {
      return Promise.resolve(new ServiceResponse({ ...response, payload: response.payload + " => hook2" }));
    },
  };
  const hook3: HookDefinition = {
    before: ({ request }) => {
      request.data += "hook3 => ";
      return Promise.resolve(request);
    },
    after: ({ response }) => {
      return Promise.resolve(new ServiceResponse({ ...response, payload: response.payload + " => hook3" }));
    },
  };
  const hooks: HookDefinition[] = [hook1, hook2];
  const definition: ServiceDefinition = {
    fn: getService,
    hooks,
    path,
    method,
  };
  describe("definition", () => {
    it("should be set to the definition argument passed into the ApplicationService constructor function", () => {
      expect(ApplicationService(app, definition).definition).toBe(definition);
    });
  });

  describe("service", () => {
    it("should be set to the fn property of the definition argument passed into the ApplicationService constructor function", () => {
      expect(ApplicationService(app, definition).service).toBe(definition.fn);
    });
  });

  describe("app", () => {
    it("should be set to the app argument passed into the ApplicationService constructor function", () => {
      expect(ApplicationService(app, definition).app).toBe(app);
    });
  });

  describe("method", () => {
    it("should be set to the method property of the definition argument passed into the ApplicationService constructor function when it is a valid method", () => {
      expect(ApplicationService(app, definition).method).toEqual(method);
    });
    it("should throw an exception when the method property in the definition argument is not a valid verb", () => {
      expect(
        () =>
          ApplicationService(app, {
            fn: getService,
            hooks,
            method: "notvalidmethod",
          }).method,
      ).toThrow(new Error("The service definition method is invalid. The method property or the first verb in the service name or operation Id must be a valid ServiceMethod."));
    });

    it("should throw an exception when the method property is not set and cannot determine valid method from fn.name and id properties of the definition argument", () => {
      expect(
        () =>
          ApplicationService(app, {
            fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
            hooks,
          }).method,
      ).toThrow(new Error("The service definition method is invalid. The method property or the first verb in the service name or operation Id must be a valid ServiceMethod."));
    });

    it("should be set to the verb parsed from the fn.name in the definition argument when no method property is provided and the verb is a valid service method", () => {
      expect(
        ApplicationService(app, {
          fn: getService,
          hooks,
        }).method,
      ).toEqual("get");
    });
    it("should be set to the verb parsed from the id in the definition argument when no method property is provided, the fn.name is not valid and the verb is a valid service method", () => {
      expect(
        ApplicationService(app, {
          id: "getSomething",
          fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
          hooks,
        }).method,
      ).toEqual("get");
    });
  });

  describe("path", () => {
    it("should be set to the path property from the service definition argument when it does not start with a forward slash", () => {
      expect(ApplicationService(app, definition).path).toEqual(path);
    });
  });

  describe("operationId", () => {
    it("should set the operationId to the id in the definition argument passed when provided", () => {
      expect(ApplicationService(app, { id: "anoperationid", fn: getService }).operationId).toEqual("anoperationid");
    });
    it("should set the operationId to the fn.name in the definition argument when NO id property was provided in the definition argument", () => {
      expect(ApplicationService(app, definition).operationId).toEqual("getService");
    });
    it("should throw an exception when the service function is NOT named and there is no id provided in the the definition argument", () => {
      expect(() => ApplicationService(app, { method: "get", resource: "resources", fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ payload: request })) }).operationId).toThrow(
        new Error("The service definition must provide an id property if the fn is not a named function."),
      );
    });
  });

  describe("resource", () => {
    it("should be set to the resource property as-is from the service definition argument", () => {
      expect(
        ApplicationService(app, {
          fn: getService,
          path,
          hooks,
          resource: "resource",
        }).resource,
      ).toEqual("resource");
    });
    it("should be set to resource segment parsed from the path property, which starts with a forward slash, of the service definition argument", () => {
      expect(
        ApplicationService(app, {
          fn: getService,
          path: "/rc/seg1/seg2",
          hooks,
          method,
        }).resource,
      ).toEqual("rc");
    });
    it("should be set to resource segment parsed from the path property, which does NOT start with a forward slash, of the service definition argument", () => {
      expect(
        ApplicationService(app, {
          fn: getService,
          path: "rc/seg1/seg2",
          hooks,
          method,
        }).resource,
      ).toEqual("rc");
    });
    it("should be set to the pluralized subject parsed from the fn.name property of the service definition argument", () => {
      expect(
        ApplicationService(app, {
          fn: getService,
          hooks,
          method,
        }).resource,
      ).toEqual("services");
    });
    it("should be set to the pluralized subject parsed from the operationId property of the service definition argument", () => {
      expect(
        ApplicationService(app, {
          fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
          id: "getOperation",
          hooks,
          method,
        }).resource,
      ).toEqual("operations");
    });
    it("should invalid resource error when no resource is provided and could not be determined from the path, fn service name, or operation ID.", () => {
      expect(() =>
        ApplicationService(app, {
          fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
          hooks,
          method,
        }),
      ).toThrow(new Error("The service definition resource is invalid. A resource is require when no path, named fn service, and no operation Id properties are provided."));
    });
  });

  describe("hooks", () => {
    describe("when call with no parameters", () => {
      it("should set the hooks method to a method that returns an array of HookFunctions created using the array of HookDefinition from the hooks property in the definition parameter", () => {
        expect(ApplicationService(app, definition).hooks().length).toEqual(2);
        expect(typeof ApplicationService(app, definition).hooks()[0]).toEqual("function");
        expect(typeof ApplicationService(app, definition).hooks()[1]).toEqual("function");
      });
      it("should set the hooks method to a method that returns an empty array when there was no hooks property in the definition parameter", () => {
        expect(ApplicationService(app, { fn: getService }).hooks().length).toEqual(0);
      });
    });
    it("should add a hook to the hooks array when the hooks method is called with a HookDefinition parameter", () => {
      const service = ApplicationService(app, definition);
      let hooks = service.hooks();
      const h0 = hooks[0];
      const h1 = hooks[1];
      expect(hooks.length).toEqual(2);
      service.hooks(hook3);
      hooks = service.hooks();
      expect(hooks.length).toEqual(3);
      expect(hooks[0]).toBe(h0);
      expect(hooks[1]).toBe(h1);
      expect(hooks[2]).not.toBe(h0);
      expect(hooks[2]).not.toBe(h1);
    });
    it("should not be able to modify the hooks array outside the application service", () => {
      const service = ApplicationService(app, definition);
      const hooks = service.hooks();
      hooks.push(ServiceHook(hook3));
      expect(service.hooks().length).toEqual(2);
    });
  });

  describe("setup", () => {
    describe("when setup is NOT provided", () => {
      const svc = ApplicationService(app, {
        fn: getService,
        path,
        hooks,
        resource: "resources",
      });
      it("should set the setup to nullable function", () => {
        expect(typeof svc.setup).toEqual("function");
      });
      it("should not blow-up when called", async () => {
        expect(await svc.setup()).toBeUndefined();
      });
    });
    describe("when setup is provided", () => {
      const setup = jest.fn(() => Promise.resolve());
      const svc = ApplicationService(app, {
        fn: getService,
        path,
        hooks,
        resource: "resources",
        setup,
      });
      beforeAll(async () => {
        await svc.setup();
      });
      it("should set the setup to nullable function", () => {
        expect(typeof svc.setup).toEqual("function");
      });
      it("should call service definition setup function with the app", async () => {
        expect(setup).toBeCalledWith(app);
      });
    });
  });
  describe("when the application service that was create is called", () => {
    it("should return a application service function that maintains the original service name", () => {
      const svc = ApplicationService(app, definition);
      expect(svc.name).toEqual("getService");
    });
    it("should return a application service function that is executable where the request is piped through the given hooks", async () => {
      const execute = ApplicationService(app, {
        fn: getService,
        hooks: [hook1, hook2, hook3],
      });
      expect((await execute(new ServiceRequest({ data: "data => ", params: { a: { b: "c" } } }))).payload).toBe("data => hook1 (param=c) => hook2 => hook3 => <<svc>> => hook3 => hook2 => hook1");
    });
  });
});
