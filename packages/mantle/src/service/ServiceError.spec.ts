/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ServiceError, ServiceErrorType } from "./index";

enum CustomErrorType {
  VAL = "validationError",
  UKN = "unkownError",
  DAT = "dataError",
}
describe("ServiceError", () => {
  describe("helpers", () => {
    describe("constructor", () => {
      it("should set the frozen property to false and allow properties to be changed when freeze argument is false", () => {
        const svcErr = new ServiceError({}, false);
        svcErr.type = ServiceErrorType.VALIDATION;
        expect(svcErr.frozen).toEqual(false);
      });
      it("should set the frozen property to true and NOT allow properties to be changed when freeze argument is true", () => {
        const svcErr = new ServiceError({}, true);
        expect(() => (svcErr.type = ServiceErrorType.VALIDATION)).toThrow();
        expect(svcErr.frozen).toEqual(true);
      });
      it("should default to frozen when the freeze argument is not passed", () => {
        const svcErr = new ServiceError({});
        expect(() => (svcErr.type = ServiceErrorType.VALIDATION)).toThrow();
        expect(svcErr.frozen).toEqual(true);
      });
      it("should not blow up when the constructor is not passed anything", () => {
        expect(new ServiceError()).toBeDefined();
      });
      it("should default to the ServiceErrorType when no error type is provided", () => {
        const svcErr = new ServiceError({}, false);
        svcErr.type = ServiceErrorType.VALIDATION;

        expect(svcErr.type).toEqual(ServiceErrorType.VALIDATION);
      });
      it("should allow custom error type without causing a TypeScript TypeError", () => {
        const svcErr = new ServiceError({ type: CustomErrorType.UKN });

        expect(svcErr.type).toEqual(CustomErrorType.UKN);
      });
      it("should copy all properties to the ServiceError", () => {
        const type = CustomErrorType.UKN;
        const inner = new Error("An Error");
        const message = "The error message";
        const data = { some: "data" };
        const svcErr = new ServiceError({ type, inner, message, data });
        expect(svcErr.type).toEqual(type);
        expect(svcErr.inner).toEqual(inner);
        expect(svcErr.message).toEqual(message);
        expect(svcErr.data).toEqual(data);
      });
    });
  });
});
