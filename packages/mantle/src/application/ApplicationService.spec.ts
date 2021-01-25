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
  const hook4: HookDefinition = {
    before: ({ request }) => {
      request.data += "hook4 => ";
      return Promise.resolve(request);
    },
    after: ({ response }) => {
      return Promise.resolve(new ServiceResponse({ ...response, payload: response.payload + " => hook4" }));
    },
  };

  const hooks: HookDefinition[] = [hook1, hook2];
  const definition: ServiceDefinition = {
    fn: getService,
    hooks,
    // path,
    method,
  };
  describe("definition", () => {
    it("should be set to the definition argument passed into the ApplicationService constructor function", () => {
      expect(ApplicationService(app, definition).definition).toBe(definition);
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
            method: "notvalidmethod" as ServiceMethod,
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
  describe("service", () => {
    it("should be set to the fn property of the definition argument passed into the ApplicationService constructor function", () => {
      expect(ApplicationService(app, definition).fn).toEqual(definition.fn);
    });
  });

  describe("resource", () => {
    it("should be set to the resource property as-is from the service definition argument", () => {
      expect(
        ApplicationService(app, {
          fn: getService,
          // path,
          hooks,
          resource: "resource",
        }).resource,
      ).toEqual("resource");
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
    it("should throw exeption when no resource given or one cannot be determined by the function name or ID", () => {
      expect(
        () =>
          ApplicationService(app, {
            fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` })),
            hooks,
            method,
          }).resource,
      ).toThrowError("The service definition resource is invalid. A resource is required when no named fn service or no operation Id properties are provided.");
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

  describe("app", () => {
    it("should be set to the app argument passed into the ApplicationService constructor function", () => {
      expect(ApplicationService(app, definition).app).toBe(app);
    });
  });

  describe("hooks", () => {
    it("should add a hook to the hooks array when the hooks method is called with a single HookDefinition parameter", () => {
      const service = ApplicationService(app, definition);
      let hooks = service.getHooks();
      const h0 = hooks[0];
      const h1 = hooks[1];
      expect(hooks.length).toEqual(2);
      service.hooks(hook3);
      hooks = service.getHooks();
      expect(hooks.length).toEqual(3);
      expect(hooks[0]).toBe(h0);
      expect(hooks[1]).toBe(h1);
      expect(hooks[2]).not.toBe(h0);
      expect(hooks[2]).not.toBe(h1);
    });
    it("should add all hooks to the hooks array inorder when the hooks method is called with an array of HookDefinition parameter", () => {
      const service = ApplicationService(app, definition);
      let hooks = service.getHooks();
      const h0 = hooks[0];
      const h1 = hooks[1];
      expect(hooks.length).toEqual(2);
      service.hooks([hook3, hook4]);
      hooks = service.getHooks();
      expect(hooks.length).toEqual(4);
      expect(hooks[0]).toBe(h0);
      expect(hooks[1]).toBe(h1);
      expect(hooks[2]).not.toBe(h0);
      expect(hooks[2]).not.toBe(h1);
    });
  });
  describe("getHooks", () => {
    it("should set the hooks method to a method that returns an array of HookFunctions created using the array of HookDefinition from the hooks property in the definition parameter", () => {
      expect(ApplicationService(app, definition).getHooks().length).toEqual(2);
      expect(typeof ApplicationService(app, definition).getHooks()[0]).toEqual("function");
      expect(typeof ApplicationService(app, definition).getHooks()[1]).toEqual("function");
    });
    it("should set the hooks method to a method that returns an empty array when there was no hooks property in the definition parameter", () => {
      expect(ApplicationService(app, { fn: getService }).getHooks().length).toEqual(0);
    });
    it("should not be able to modify the hooks array outside the application service", () => {
      const service = ApplicationService(app, definition);
      const hooks = service.getHooks();
      hooks.push(ServiceHook(hook3));
      expect(service.getHooks().length).toEqual(2);
    });
  });

  describe("setup", () => {
    describe("when setup is NOT provided", () => {
      const svc = ApplicationService(app, {
        fn: getService,
        // path,
        hooks,
        resource: "resources",
      });
      it("should set the setup to nullable function", () => {
        expect(typeof svc.setup).toEqual("function");
      });
      it("should not blow-up when called", () => {
        expect(svc.setup()).toEqual(svc);
      });
    });
    describe("when setup is provided", () => {
      const setup = jest.fn(() => Promise.resolve());
      const svc = ApplicationService(app, {
        fn: getService,
        // path,
        hooks,
        resource: "resources",
        setup,
      });
      beforeAll(async () => {
        svc.setup();
      });
      it("should set the setup to nullable function", () => {
        expect(typeof svc.setup).toEqual("function");
      });
      it("should call service definition setup function with the app", async () => {
        expect(setup).toBeCalledWith(app);
      });

      it("should only run setup up once", () => {
        svc.setup();
        expect(setup).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("isSetup", () => {
    it("should return false when setup was NOT called", () => {
      const service = ApplicationService(app, definition);
      expect(service.isSetup).toEqual(false);
    });
    it("should return true when setup was called", () => {
      const service = ApplicationService(app, definition);
      service.setup();
      expect(service.isSetup).toEqual(true);
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
