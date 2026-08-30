import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./app.js";

describe("App", () => {
  it("shows the login form when not authenticated", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Mantle KB" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
  });
});
