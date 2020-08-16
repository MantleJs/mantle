import { getSomething } from "./index";
describe("mantle", () => {
  it("should return something", () => {
    expect(getSomething()).toEqual("something");
  });
});
