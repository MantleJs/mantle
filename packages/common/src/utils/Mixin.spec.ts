import { Mixin } from "./Mixin";

class ObjectMixin1 {
  public get obj1() {
    return true;
  }
  public getObject1() {
    return "object1";
  }
}
class ObjectMixin2 {
  public get obj2() {
    return true;
  }
  public getObject2() {
    return "object2";
  }
}
class ParentClass {
  public getParent() {
    return "parent";
  }
}

interface ParentClass extends ObjectMixin1, ObjectMixin2 {}

Mixin.apply(ParentClass, [ObjectMixin1, ObjectMixin2]);

describe("Mixin", () => {
  let parentInst: ParentClass;
  beforeAll(() => {
    parentInst = new ParentClass();
  });
  describe("apply", () => {
    it("should apply all properties and functions to the class being mixed in", () => {
      expect(typeof parentInst.obj1).toEqual("boolean");
      expect(typeof parentInst.getObject1).toEqual("function");
      expect(typeof parentInst.obj2).toEqual("boolean");
      expect(typeof parentInst.getObject2).toEqual("function");
      expect(typeof parentInst.getParent).toEqual("function");
    });
  });
});
