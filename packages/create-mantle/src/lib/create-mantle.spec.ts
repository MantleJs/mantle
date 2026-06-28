import { newProject } from "./create-mantle.js";

describe("create-mantle", () => {
  it("re-exports newProject from @mantlejs/cli", () => {
    expect(typeof newProject).toBe("function");
  });
});
