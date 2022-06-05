import { Application } from "./Application";
import { ProtocolType } from "./ProtocolProvider";
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
    describe("when one protocol is set", () => {
      let app: Application;
      const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
      beforeEach(() => {
        app = new Application();
        app.protocols(firstProtocol);
      });
      afterEach(() => {
        firstProtocol.fn.mockReset();
      });
      it("should add the service to the list of services when no protocol options is provided", () => {
        app.use(svcDef);
        expect(app.services[0].name).toEqual(getSvc.name);
      });
      it("should add the service to the list of services when protocol options is provided", () => {
        app.use(svcDef, { type: ProtocolType.HTTP, style: "REST" });
        expect(app.services[0].name).toEqual(getSvc.name);
      });
    });
    describe("when the application has already been setup", () => {
      let app: Application;
      const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
      const mockSetup = jest.fn();
      beforeEach(() => {
        app = new Application();
        app.protocols(firstProtocol);
        app.setup();
        svcDef.setup = mockSetup;
        app.use(svcDef);
      });
      afterEach(() => {
        firstProtocol.fn.mockReset();
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
      app.protocols({ type: ProtocolType.HTTP, fn: () => undefined });
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
        app.protocols({ type: ProtocolType.HTTP, fn: () => undefined });
        app.use({ fn: getSvc, setup });
        app.setup();
      });
      it("should call the registered services setup function", () => {
        expect(setup).toBeCalled();
      });
    });
    describe("when no protocol is set", () => {
      it("should throw not protocol configured exception when service definition and NO protocol options are passed", () => {
        const app = new Application();
        app.use(svcDef);
        expect(() => app.setup()).toThrowError("No protocol configured");
      });
      it("should throw no protocol configured exception when service definition and protocol options are passed", () => {
        const app = new Application();
        app.use(svcDef, { type: ProtocolType.HTTP, style: "RPC" });
        expect(() => app.setup()).toThrowError("No protocol configured");
      });
    });
    describe("when one protocol is set", () => {
      it("should pick the default protocol when service does not have a protocol configured", () => {
        const app = new Application();
        const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
        app.protocols(firstProtocol);
        app.use(svcDef);
        app.setup();
        expect(firstProtocol.fn).toBeCalled();
      });
      it("should pick the protocol when the service protocol option matches the type and style", () => {
        const app = new Application();
        const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
        app.protocols(firstProtocol);
        app.use(svcDef, { type: ProtocolType.HTTP, style: "REST" });
        app.setup();
        expect(firstProtocol.fn).toBeCalled();
      });
      it("should throw protocol not found expection when service definition and protocol options type and style are passed", () => {
        const app = new Application();
        const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
        app.protocols(firstProtocol);
        app.use(svcDef, { type: ProtocolType.HTTP, style: "REST" });
        app.setup();
        expect(() => app.use(svcDef, { type: ProtocolType.WebSocket, style: "RPC" })).toThrowError(new Error("No protocol found for type WebSocket and style RPC"));
      });
      it("should throw protocol not found expection when service definition and protocol options type are passed", () => {
        const app = new Application();
        const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
        app.protocols(firstProtocol);
        app.use(svcDef, { type: ProtocolType.HTTP, style: "REST" });
        app.setup();
        expect(() => app.use(svcDef, { type: ProtocolType.WebSocket })).toThrowError(new Error("No protocol found for type WebSocket"));
      });
    });
    describe("when more than one protocol is set", () => {
      const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
      const secondProtocol = { type: ProtocolType.HTTP, style: "RPC", fn: jest.fn() };
      const thirdProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
      afterEach(() => {
        firstProtocol.fn.mockReset();
        secondProtocol.fn.mockReset();
        thirdProtocol.fn.mockReset();
      });
      it("should not run service setup when setup is called more than once", () => {
        const app = new Application();
        app.protocols(firstProtocol);
        app.protocols(secondProtocol);
        app.protocols(thirdProtocol);
        app.use(svcDef, { type: ProtocolType.HTTP, style: "RPC" });
        app.setup();
        app.setup();
        expect(secondProtocol.fn).toHaveBeenCalledTimes(1);
      });
      it("should throw 'More than one default protocol configured' exception when service was configured with no protocol options", () => {
        const app = new Application();
        app.protocols(firstProtocol);
        app.protocols(secondProtocol);
        app.protocols(thirdProtocol);
        app.use(svcDef);
        expect(() => app.setup()).toThrowError("More than one default protocol configured");
      });
      it("should pick the protocol that matches the type and style when service was configured with protocol options that matches a type and style", () => {
        const app = new Application();
        app.protocols(firstProtocol);
        app.protocols(secondProtocol);
        app.protocols(thirdProtocol);
        app.use(svcDef, { type: ProtocolType.HTTP, style: "RPC" });
        app.setup();
        expect(firstProtocol.fn).not.toBeCalled();
        expect(secondProtocol.fn).toBeCalled();
      });
      it("should throw protocol 'No protocol found' expection when service definition and protocol options are passed when protocol options is provided that does NOT match a type and style", () => {
        const app = new Application();
        app.protocols(firstProtocol);
        app.protocols(secondProtocol);
        app.protocols(thirdProtocol);
        app.use(svcDef, { type: ProtocolType.WebSocket, style: "RPC" });
        expect(() => app.setup()).toThrowError("No protocol found");
      });
      it("should throw 'More than one protocol found for type HTTP and style REST' exception when protocol options is provided that matches more than one protocol for the given type and style", () => {
        const app = new Application();
        app.protocols(firstProtocol);
        app.protocols(secondProtocol);
        app.protocols(thirdProtocol);
        app.use(svcDef, { type: ProtocolType.HTTP, style: "REST" });
        expect(() => app.setup()).toThrowError("More than one protocol found for type HTTP and style REST");
      });
      it("should throw 'More than one protocol found for type HTTP and style REST' exception when protocol options is provided that matches more than one protocol for the given type", () => {
        const app = new Application();
        app.protocols(firstProtocol);
        app.protocols(secondProtocol);
        app.protocols(thirdProtocol);
        app.use(svcDef, { type: ProtocolType.HTTP });
        expect(() => app.setup()).toThrowError("More than one protocol found for type HTTP");
      });
    });
  });
  describe("listen", () => {
    let app: Application;

    beforeAll(() => {
      app = new Application();
    });
    it("should call configure function the app instance", async () => {
      await expect(app.listen).rejects.toEqual(new Error("Failed to start listening. No protocol attached"));
    });
  });
  describe("protocols", () => {
    let app: Application;
    const firstProtocol = { type: ProtocolType.HTTP, style: "REST", fn: jest.fn() };
    const mockSetup = jest.fn();
    beforeEach(() => {
      app = new Application();
      app.setup();
    });
    afterEach(() => {
      firstProtocol.fn.mockReset();
      mockSetup.mockReset();
    });
    it("should throw 'Cannot attach protocol provider after application has been setup' exception when application is already setup", () => {
      expect(() => app.protocols(firstProtocol)).toThrowError("Cannot attach protocol provider after application has been setup");
    });
  });
});
