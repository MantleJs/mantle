import { newProject } from "./create-mantlejs.js";

describe("create-mantlejs", () => {
  it("re-exports newProject from @mantlejs/cli", () => {
    expect(typeof newProject).toBe("function");
  });
});
