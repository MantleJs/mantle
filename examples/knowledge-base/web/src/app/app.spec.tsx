import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./app.js";

describe("App", () => {
  it("shows the login form once the (absent) persisted session check resolves", async () => {
    render(<App />);
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mantle KB" })).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Google" }).getAttribute("href")).toMatch(/\/auth\/google$/);
  });

  it("switches to the registration form", async () => {
    render(<App />);
    await screen.findByLabelText("Email");
    await userEvent.setup().click(screen.getByRole("button", { name: "Register" }));
    expect(screen.getByLabelText("Name")).toBeTruthy();
    // The mode toggle plus the sign-up form's own submit button.
    const registerButtons = screen.getAllByRole("button", { name: "Register" });
    expect(registerButtons.map((button) => button.getAttribute("type"))).toEqual(["button", "submit"]);
  });
});
