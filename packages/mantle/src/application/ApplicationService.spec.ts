import { ApplicationService, Application } from "./index";
import { ServiceDefinition, ServiceMethod } from "./ApplicationService";
import { ServiceFunction, ServiceRequest, ServiceResponse, HookDefinition, ServiceHook, ServiceResponseType } from "../service";

describe("ApplicationService", () => {
  const app = new Application();
  const path = "/path/to/something";
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
    method,
  };
  describe("when service definition are provided", () => {
    it("should create an application service function with definition property set to the service definition parameter passed to the constructor function", () => {
      expect(ApplicationService(app, path, definition).definition).toBe(definition);
    });
    it("should create an application service function with service property set to the service function in the definition parameter passed to the constructor function", () => {
      expect(ApplicationService(app, path, definition).service).toBe(definition.fn);
    });
    it("should create an application service function with app property set to the app parameter passed to the constructor function", () => {
      expect(ApplicationService(app, path, definition).app).toBe(app);
    });
    it("should create an application service function with method property set to the method parameter passed to the constructor function", () => {
      expect(ApplicationService(app, path, definition).method).toEqual(method);
    });
    it("should thow an exception when the method is not a valid verb", () => {
      expect(
        () =>
          ApplicationService(app, path, {
            fn: getService,
            hooks,
            method: "notvalidmethod",
          }).method,
      ).toThrow(new Error("The service definition a service method is invalid. The method property or the first verb in the service name or operation Id must be a valid ServiceMethod"));
    });
    it("should get the method from the service name when no method property is provided", () => {
      expect(
        ApplicationService(app, path, {
          fn: getService,
          hooks,
        }).method,
      ).toEqual("get");
    });
    it("should create an application service function with path property set to the path parameter passed to the constructor function", () => {
      expect(ApplicationService(app, path, definition).path).toEqual(path);
    });
    it("should create an application service function with operationId property set to the service function name in the definition parameter passed to the constructor function when NO id is provided in the service definition", () => {
      expect(ApplicationService(app, path, definition).operationId).toEqual("getService");
    });
    it("should create an application service function with operationId property set to the id in the definition parameter passed to the constructor function when the id is provided in the service definition", () => {
      expect(ApplicationService(app, path, { id: "anoperationid", fn: getService }).operationId).toEqual("anoperationid");
    });
    it("should throw an exception when the service function is NOT named and there is no id provided in the service definition parameter passed to constructor function", () => {
      expect(() => ApplicationService(app, path, { method: "get", fn: (request: ServiceRequest) => Promise.resolve(new ServiceResponse({ payload: request })) }).operationId).toThrow(
        new Error("The service definition must provide an id property if the fn is not a named function"),
      );
    });
    it("should create an application service function with hooks function that returns an array of HookFunctions created from the HookDefinitions parameter passed to the constructor function", () => {
      expect(ApplicationService(app, path, definition).hooks().length).toEqual(2);
      expect(typeof ApplicationService(app, path, definition).hooks()[0]).toEqual("function");
      expect(typeof ApplicationService(app, path, definition).hooks()[1]).toEqual("function");
    });
    it("should create an application service function with hooks function that returns an empty array when the definition parameterassed to the constructor function does not provide any hooks", () => {
      expect(ApplicationService(app, path, { fn: getService }).hooks().length).toEqual(0);
    });
    it("should add a hook function to the end of the hooks array when the application service hook with is call with a hook definition", () => {
      const service = ApplicationService(app, path, definition);
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
      const service = ApplicationService(app, path, definition);
      const hooks = service.hooks();
      hooks.push(ServiceHook(hook3));
      expect(service.hooks().length).toEqual(2);
    });
    it("should return a application service function that maintains the original service name", () => {
      const svc = ApplicationService(app, path, definition);
      expect(svc.name).toEqual("getService");
    });
    it("should return a service that is executable where the request is piped through the hooks", async () => {
      const execute = ApplicationService(app, path, {
        fn: getService,
        hooks: [hook1, hook2, hook3],
      });
      expect((await execute(new ServiceRequest({ data: "data => ", params: { a: { b: "c" } } }))).payload).toBe("data => hook1 (param=c) => hook2 => hook3 => <<svc>> => hook3 => hook2 => hook1");
    });
    it("should add a group property on the created application service function from the service method name with the verb removed and pluralized", () => {
      expect(ApplicationService(app, path, definition).group).toEqual("services");
    });
  });
});
