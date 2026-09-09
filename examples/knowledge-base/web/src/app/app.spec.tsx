import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./app.js";

describe("App", () => {
  it("shows the login form once the (absent) persisted session check resolves", async () => {
    render(<App />);
    expect(await screen.findByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mantle KB" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
  });
});
