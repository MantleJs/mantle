import { Application } from "./Application";
import { TransportType } from "./TransportProvider";
import { HookDefinition, ServiceHook, ServiceRequest, ServiceResponse } from "../service";
import { ServiceDefinition } from "./ApplicationService";

describe("Application", () => {
  describe("constructor", () => {
    describe("when no arguments are provided", () => {
      let app: Application;
      beforeAll(() => {
        app = new Application();
      });
      it("should be an application instance", () => {
        expect(app).toBeInstanceOf(Application);
      });
      it("should have an empty services list", () => {
        expect(app.services).toEqual([]);
      });
      it("should have empty hooks list", () => {
        expect(app.getHooks()).toEqual([]);
      });
    });
    describe("when arguments are provided with hooks", () => {
      let app: Application;
      const hook1: HookDefinition = {};
      const shook1 = ServiceHook(hook1);
      beforeAll(() => {
        app = new Application({ hooks: [hook1] });
      });
      it("should be an application instance", () => {
        expect(app).toBeInstanceOf(Application);
      });
      it("should have an empty services list", () => {
        expect(app.services).toEqual([]);
      });
      it("should have hooks list with the hook provided in the arguments", () => {
        expect(typeof app.getHooks()[0]).toEqual("function");
      });
    });
  });
  describe("version", () => {
    it("should return the application version", () => {
      expect(new Application().version).toBeDefined();
    });
  });
  describe("use", () => {
    const getSvc = (r: ServiceRequest) => Promise.resolve(new ServiceResponse({ payload: r }));
    const svcDef: ServiceDefinition = {
      fn: getSvc,
    };
    describe("when one transport is set", () => {
      let app: Application;
      const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
      beforeEach(() => {
        app = new Application();
        app.attachTransport(firstTransport);
      });
      afterEach(() => {
        firstTransport.fn.mockReset();
      });
      it("should add the service to the list of services when no transport options is provided", () => {
        app.use(svcDef);
        expect(app.services[0].name).toEqual(getSvc.name);
      });
      it("should add the service to the list of services when transport options is provided", () => {
        app.use(svcDef, { type: TransportType.HTTP, style: "REST" });
        expect(app.services[0].name).toEqual(getSvc.name);
      });
    });
    describe("when the application has already been setup", () => {
      let app: Application;
      const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
      const mockSetup = jest.fn();
      beforeEach(() => {
        app = new Application();
        app.attachTransport(firstTransport);
        app.setup();
        svcDef.setup = mockSetup;
        app.use(svcDef);
      });
      afterEach(() => {
        firstTransport.fn.mockReset();
        mockSetup.mockReset();
      });
      it("should call service setup method", () => {
        expect(svcDef.setup).toBeCalled();
      });
    });
  });
  describe("getService", () => {
    let app: Application;
    const getSvc = (r: ServiceRequest) => Promise.resolve(new ServiceResponse({ payload: r }));
    const svcDef: ServiceDefinition = {
      fn: getSvc,
    };
    const operationId = getSvc.name;
    beforeAll(() => {
      app = new Application();
      app.attachTransport({ type: TransportType.HTTP, fn: () => undefined });
      app.use(svcDef);
    });
    it("should add the service to the list of services when given a service definition", () => {
      expect(app.getService(operationId).operationId).toEqual(operationId);
    });
  });
  describe("hooks", () => {
    it("should add all hooks when passed an array of hook definitions", () => {
      expect(new Application().hooks([{}, {}]).getHooks().length).toEqual(2);
    });
    it("should add hook when passed a single hook definition", () => {
      expect(new Application().hooks({}).getHooks().length).toEqual(1);
    });
  });
  describe("configure", () => {
    let app: Application;
    const fn = jest.fn();

    beforeAll(() => {
      app = new Application();
      app.configure(fn);
    });
    it("should call configure function the app instance", () => {
      expect(fn).toBeCalledWith(app);
    });
  });
  describe("setup", () => {
    const getSvc = (r: ServiceRequest) => Promise.resolve(new ServiceResponse({ payload: r }));
    const svcDef: ServiceDefinition = {
      fn: getSvc,
    };
    const setup = jest.fn();

    describe("when app setup is called", () => {
      let app: Application;
      beforeAll(() => {
        app = new Application();
        app.attachTransport({ type: TransportType.HTTP, fn: () => undefined });
        app.use({ fn: getSvc, setup });
        app.setup();
      });
      it("should call the registered services setup function", () => {
        expect(setup).toBeCalled();
      });
    });
    describe("when no transport is set", () => {
      it("should throw not transport configured exception when service definition and NO transport options are passed", () => {
        const app = new Application();
        app.use(svcDef);
        expect(() => app.setup()).toThrowError("No transport configured");
      });
      it("should throw no transport configured exception when service definition and transport options are passed", () => {
        const app = new Application();
        app.use(svcDef, { type: TransportType.HTTP, style: "RPC" });
        expect(() => app.setup()).toThrowError("No transport configured");
      });
    });
    describe("when one transport is set", () => {
      it("should pick the default transport when service does not have a transport configured", () => {
        const app = new Application();
        const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
        app.attachTransport(firstTransport);
        app.use(svcDef);
        app.setup();
        expect(firstTransport.fn).toBeCalled();
      });
      it("should pick the transport when the service transport option matches the type and style", () => {
        const app = new Application();
        const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
        app.attachTransport(firstTransport);
        app.use(svcDef, { type: TransportType.HTTP, style: "REST" });
        app.setup();
        expect(firstTransport.fn).toBeCalled();
      });
      it("should throw transport not found expection when service definition and transport options type and style are passed", () => {
        const app = new Application();
        const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
        app.attachTransport(firstTransport);
        app.use(svcDef, { type: TransportType.HTTP, style: "REST" });
        app.setup();
        expect(() => app.use(svcDef, { type: TransportType.WebSocket, style: "RPC" })).toThrowError(new Error("No transport found for type WebSocket and style RPC"));
      });
      it("should throw transport not found expection when service definition and transport options type are passed", () => {
        const app = new Application();
        const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
        app.attachTransport(firstTransport);
        app.use(svcDef, { type: TransportType.HTTP, style: "REST" });
        app.setup();
        expect(() => app.use(svcDef, { type: TransportType.WebSocket })).toThrowError(new Error("No transport found for type WebSocket"));
      });
    });
    describe("when more than one transport is set", () => {
      const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
      const secondTransport = { type: TransportType.HTTP, style: "RPC", fn: jest.fn() };
      const thirdTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
      afterEach(() => {
        firstTransport.fn.mockReset();
        secondTransport.fn.mockReset();
        thirdTransport.fn.mockReset();
      });
      it("should not run service setup when setup is called more than once", () => {
        const app = new Application();
        app.attachTransport(firstTransport);
        app.attachTransport(secondTransport);
        app.attachTransport(thirdTransport);
        app.use(svcDef, { type: TransportType.HTTP, style: "RPC" });
        app.setup();
        app.setup();
        expect(secondTransport.fn).toHaveBeenCalledTimes(1);
      });
      it("should throw 'More than one default transport configured' exception when service was configured with no transport options", () => {
        const app = new Application();
        app.attachTransport(firstTransport);
        app.attachTransport(secondTransport);
        app.attachTransport(thirdTransport);
        app.use(svcDef);
        expect(() => app.setup()).toThrowError("More than one default transport configured");
      });
      it("should pick the transport that matches the type and style when service was configured with transport options that matches a type and style", () => {
        const app = new Application();
        app.attachTransport(firstTransport);
        app.attachTransport(secondTransport);
        app.attachTransport(thirdTransport);
        app.use(svcDef, { type: TransportType.HTTP, style: "RPC" });
        app.setup();
        expect(firstTransport.fn).not.toBeCalled();
        expect(secondTransport.fn).toBeCalled();
      });
      it("should throw transport 'No transport found' expection when service definition and transport options are passed when transport options is provided that does NOT match a type and style", () => {
        const app = new Application();
        app.attachTransport(firstTransport);
        app.attachTransport(secondTransport);
        app.attachTransport(thirdTransport);
        app.use(svcDef, { type: TransportType.WebSocket, style: "RPC" });
        expect(() => app.setup()).toThrowError("No transport found");
      });
      it("should throw 'More than one transport found for type HTTP and style REST' exception when transport options is provided that matches more than one transport for the given type and style", () => {
        const app = new Application();
        app.attachTransport(firstTransport);
        app.attachTransport(secondTransport);
        app.attachTransport(thirdTransport);
        app.use(svcDef, { type: TransportType.HTTP, style: "REST" });
        expect(() => app.setup()).toThrowError("More than one transport found for type HTTP and style REST");
      });
      it("should throw 'More than one transport found for type HTTP and style REST' exception when transport options is provided that matches more than one transport for the given type", () => {
        const app = new Application();
        app.attachTransport(firstTransport);
        app.attachTransport(secondTransport);
        app.attachTransport(thirdTransport);
        app.use(svcDef, { type: TransportType.HTTP });
        expect(() => app.setup()).toThrowError("More than one transport found for type HTTP");
      });
    });
  });
  describe("listen", () => {
    let app: Application;

    beforeAll(() => {
      app = new Application();
    });
    it("should call configure function the app instance", async () => {
      await expect(app.listen).rejects.toEqual(new Error("Failed to start listening. No transport attached"));
    });
  });
  describe("attachTransport", () => {
    let app: Application;
    const firstTransport = { type: TransportType.HTTP, style: "REST", fn: jest.fn() };
    const mockSetup = jest.fn();
    beforeEach(() => {
      app = new Application();
      app.setup();
    });
    afterEach(() => {
      firstTransport.fn.mockReset();
      mockSetup.mockReset();
    });
    it("should throw 'Cannot attach transport provider after application has been setup' exception when application is already setup", () => {
      expect(() => app.attachTransport(firstTransport)).toThrowError("Cannot attach transport provider after application has been setup");
    });
  });
});
