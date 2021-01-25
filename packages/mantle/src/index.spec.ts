import mantle, { Application } from "./index";
describe("mantle", () => {
  it("should return instance of application", () => {
    expect(mantle()).toBeInstanceOf(Application);
  });
});
