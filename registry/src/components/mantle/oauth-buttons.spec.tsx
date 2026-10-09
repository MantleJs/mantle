import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/harness";
import { OAuthButtons } from "@/components/mantle/oauth-buttons";

describe("OAuthButtons", () => {
  it("links every provider to its @mantlejs/auth-oauth redirect route", () => {
    render(<OAuthButtons apiUrl="http://api.test/" />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Continue with Google", "http://api.test/auth/google"],
      ["Continue with GitHub", "http://api.test/auth/github"],
      ["Continue with Facebook", "http://api.test/auth/facebook"],
      ["Continue with Apple", "http://api.test/auth/apple"],
      ["Continue with Microsoft", "http://api.test/auth/microsoft"],
      ["Continue with LinkedIn", "http://api.test/auth/linkedin"],
      ["Continue with X", "http://api.test/auth/twitter"],
    ]);
  });

  it("renders only the chosen providers, in order, with path and label overrides", () => {
    render(
      <OAuthButtons
        apiUrl="http://api.test"
        providers={["github", "google"]}
        paths={{ github: "/oauth/gh" }}
        label={(name) => `Sign in with ${name}`}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Sign in with GitHub", "http://api.test/oauth/gh"],
      ["Sign in with Google", "http://api.test/auth/google"],
    ]);
  });

  it("is reachable keyboard-only, one tab stop per provider", async () => {
    render(<OAuthButtons apiUrl="http://api.test" providers={["google", "apple"]} />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Continue with Google");
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Continue with Apple");
  });

  it("has no axe violations", async () => {
    const { container } = render(<OAuthButtons apiUrl="http://api.test" />);
    await expectNoAxeViolations(container);
  });
});
