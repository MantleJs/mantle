/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Express } from "express";
import { mock, MockProxy, mockReset } from "jest-mock-extended";
import mantle, { Application, ServiceResponse } from "@mantlejs/mantle";
import express, { MantleExpress } from "./index";
import { Server } from "http";
import { or } from "ramda";

describe("express", () => {
  let mockExpressApp: MockProxy<Express>;
  let expressApp: Express;
  let mantleApp: Application;
  let originalExpressUse: MockProxy<Express>["use"];
  let originalExpressListen: MockProxy<Express>["listen"];
  let mantleUseSpy: jest.SpyInstance;
  let mantleSetupSpy: jest.SpyInstance;
  const server: Server = ({ a: "server " } as unknown) as Server;

  beforeEach(() => {
    mockExpressApp = mock<Express>();
    mockExpressApp.listen = (jest.fn() as unknown) as MockProxy<Express>["listen"];
    expressApp = (mockExpressApp as unknown) as Express;
    mantleApp = mantle();
    mantleUseSpy = jest.spyOn(mantleApp, "use").mockImplementation();
    mantleSetupSpy = jest.spyOn(mantleApp, "setup").mockImplementation();
    originalExpressUse = mockExpressApp.use;
    originalExpressListen = mockExpressApp.listen;
  });
  beforeEach(() => {
    mockReset(mockExpressApp);
    mantleUseSpy.mockReset();
    mantleSetupSpy.mockReset();
  });

  describe("when the mantle app is provided", () => {
    let app: MantleExpress;

    beforeEach(() => {
      app = express(mantleApp, expressApp) as MantleExpress;
    });

    it("should return the express app", () => {
      expect(app).toBe(expressApp);
    });

    it("should copy the mantle app's properties to the express app", () => {
      Object.getOwnPropertyNames(mantleApp).forEach((name) => {
        // @ts-ignore
        expect(mockExpressApp[name]).toBeDefined();
      });
    });
    it("should copy the mantle app's prototype to the express app", () => {
      Object.getOwnPropertyNames(Application.prototype).forEach((name) => {
        // @ts-ignore
        expect(mockExpressApp[name]).toBeDefined();
      });
    });

    describe("use", () => {
      it("should override the express app's use method", () => {
        expect(expressApp.use).not.toBe(originalExpressUse);
      });

      describe("when use is called with a service definition", () => {
        let useRtn: any;
        beforeEach(() => {
          useRtn = app.use({ fn: () => Promise.resolve(new ServiceResponse()) });
        });
        it("should call the mantle applicaton use method when a service definiton is provided", () => {
          expect(mantleApp.use).toBeCalled();
        });

        it("should NOT call the express applicaton use method when a service definiton is provided", () => {
          expect(originalExpressUse).not.toBeCalled();
        });

        it("should return the express application when a service definiton is provided", () => {
          expect(useRtn).toEqual(app);
        });
      });
      describe("when use is NOT called with a service definition", () => {
        let listenRtn: any;
        beforeEach(() => {
          listenRtn = app.use((req: any, res: any) => true);
        });
        it("should NOT call the mantle applicaton use method when a service definiton is provided", () => {
          expect(mantleApp.use).not.toBeCalled();
        });

        it("should call the express applicaton use method when a service definiton is provided", () => {
          expect(originalExpressUse).toBeCalled();
        });

        it("should return the express application when a service definiton is provided", () => {
          expect(listenRtn).toEqual(app);
        });
      });
    });
    describe("listen", () => {
      it("should override the express app's use method", () => {
        expect(expressApp.listen).not.toBe(originalExpressListen);
      });
      describe("when called", () => {
        beforeEach(() => {
          app.listen(3000);
        });
        it("should call the express listen method", () => {
          expect(originalExpressListen).toBeCalledWith(3000);
        });
        it("should call mantle app setup method", () => {
          expect(app.setup).toBeCalled();
        });
      });
    });
  });
});
