/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ObjectUtil } from "./ObjectUtil";
describe("ObjectUtil", () => {
  describe("getFirstPropValue", () => {
    describe("when the propNames is an array of names", () => {
      const arrayOfPropNames = ["nbId", "nb_id", "nb"];
      it("should return undefined if the object is undefined", () => {
        expect(ObjectUtil.getFirstPropValue(arrayOfPropNames, undefined)).toBeUndefined();
      });
      it("should return the value when the property exists on the given object", () => {
        expect(ObjectUtil.getFirstPropValue(arrayOfPropNames, { nbId: 1 })).toBe(1);
      });
      it("should return undefined when the property does NOT exist on the given object", () => {
        expect(ObjectUtil.getFirstPropValue(["nb_id", "nb"], { nbId: 1 })).toBeUndefined();
      });
    });
    describe("when the propNames is an array of array of names", () => {
      const arrayOfPropNames = [
        ["params", "nbId"],
        ["params", "nb_id"],
        ["params", "nb"],
      ];
      it("should return undefined if the object is undefined", () => {
        expect(ObjectUtil.getFirstPropValue(arrayOfPropNames, undefined)).toBeUndefined();
      });
      it("should return the value when the property exists on the given object", () => {
        expect(ObjectUtil.getFirstPropValue(arrayOfPropNames, { params: { nb_id: 1 } })).toBe(1);
      });
      it("should return undefined when the property does NOT exist on the given object", () => {
        expect(
          ObjectUtil.getFirstPropValue(
            [
              ["params", "nbId"],
              ["params", "nb"],
            ],
            { params: { nb_id: 1 } },
          ),
        ).toBeUndefined();
      });
    });
  });
  describe("isObject", () => {
    it("should return true when the value is an object", () => {
      expect(ObjectUtil.isObject({})).toEqual(true);
    });
    it("should return false when the value is null", () => {
      expect(ObjectUtil.isObject(null)).toEqual(false);
    });
    it("should return false when the value is a number", () => {
      expect(ObjectUtil.isObject(1)).toEqual(false);
    });
    it("should return false when the value is undefined", () => {
      expect(ObjectUtil.isObject(undefined)).toEqual(false);
    });
  });
  describe("copyTo", () => {
    it("should copy all the properties of the source to the destination", () => {
      expect(ObjectUtil.copyTo({ a: "1", b: "2" }, { c: "3", d: "4" })).toEqual({ a: "1", b: "2", c: "3", d: "4" });
    });
    it("should destination object when the source is undefined", () => {
      expect(ObjectUtil.copyTo(undefined, { c: "3", d: "4" })).toEqual({ c: "3", d: "4" });
    });

    it("should not copy property when the corresponding destination property is readonly", () => {
      expect(
        ObjectUtil.copyTo(
          { a: "1", b: "2" },
          {
            get a() {
              return "2";
            },
            c: "3",
            d: "4",
          },
        ),
      ).toEqual({ a: "2", b: "2", c: "3", d: "4" });
    });
  });
  describe("isReadOnlyProperty", () => {
    it("should return true when the property only has getter is an anonymous object instance", () => {
      expect(
        ObjectUtil.isReadOnlyProperty(
          {
            get a() {
              return 1;
            },
          },
          "a",
        ),
      ).toEqual(true);
    });
    it("should return true when the property only has getter and is a class instance", () => {
      class B {
        get a() {
          return 1;
        }
      }
      expect(ObjectUtil.isReadOnlyProperty(new B(), "a")).toEqual(true);
    });
    it("should return false when the property has getter and a setter", () => {
      expect(
        ObjectUtil.isReadOnlyProperty(
          {
            get a() {
              return 1;
            },
            set a(v) {
              this.v = v;
            },
          },
          "a",
        ),
      ).toEqual(false);
    });
    it("should return false when the property has getter and a setter for a class", () => {
      class A {
        public v: any;
        get a() {
          return 1;
        }
        set a(v) {
          this.v = v;
        }
      }
      expect(ObjectUtil.isReadOnlyProperty(A, "a")).toEqual(false);
    });
    it("should return false when the property is a normal property", () => {
      expect(
        ObjectUtil.isReadOnlyProperty(
          {
            a: "normal",
          },
          "a",
        ),
      ).toEqual(false);
    });
    it("should return false when the property object is undefined", () => {
      expect(ObjectUtil.isReadOnlyProperty(undefined, "a")).toEqual(false);
    });
    it("should return false when property does not exist on project", () => {
      expect(ObjectUtil.isReadOnlyProperty({ b: 0 }, "a")).toEqual(false);
    });
    it("should return false when property name is not a string", () => {
      expect(ObjectUtil.isReadOnlyProperty({ b: 0 }, undefined)).toEqual(false);
    });
  });
  describe("isClass", () => {
    class A {}
    class B extends A {}
    it("should return true when object is a class definition", () => {
      expect(ObjectUtil.isClass(A)).toEqual(true);
    });
    it("should return true when object is a class instance", () => {
      expect(ObjectUtil.isClass(new A())).toEqual(true);
    });
    it("should return true when object is a class derived from another class", () => {
      expect(ObjectUtil.isClass(B)).toEqual(true);
    });
    it("should return true when object is a instance of a class derived from another class", () => {
      expect(ObjectUtil.isClass(new B())).toEqual(true);
    });

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    function C() {
      return this;
    }
    it("should return false when object is a function", () => {
      expect(ObjectUtil.isClass(C)).toEqual(false);
    });
    it("should return false when undefined", () => {
      // @ts-ignore
      expect(ObjectUtil.isClass()).toEqual(false);
    });
    it("should return false when object is a newed function", () => {
      // @ts-ignore
      expect(ObjectUtil.isClass(new C())).toEqual(false);
    });
    it("should return false when object is an anonymous object", () => {
      expect(ObjectUtil.isClass({})).toEqual(false);
    });
    it("should return false when object is a Date", () => {
      expect(ObjectUtil.isClass(Date)).toEqual(false);
    });
    it("should return false when object is a Date instance", () => {
      expect(ObjectUtil.isClass(new Date())).toEqual(false);
    });
  });
});
