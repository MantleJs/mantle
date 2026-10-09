import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createHarness, errorResponse, expectNoAxeViolations, jsonResponse } from "@/test/harness";
import { AuthProvider, useAuth } from "@/components/mantle/auth-provider";
import { LoginForm } from "@/components/mantle/login-form";

function Status() {
  return <p data-testid="status">{useAuth().status}</p>;
}

async function setup() {
  const harness = createHarness();
  const onSuccess = vi.fn();
  const view = harness.render(
    <AuthProvider>
      <LoginForm onSuccess={onSuccess} />
      <Status />
    </AuthProvider>,
  );
  await screen.findByText("unauthenticated");
  return { ...harness, onSuccess, view };
}

describe("LoginForm", () => {
  it("authenticates with the local strategy and reports success", async () => {
    const { fetchMock, onSuccess } = await setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: "a", refreshToken: "r", user: { id: 1 } }));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "a" })));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api.test/authentication");
    expect(JSON.parse(String(init?.body))).toEqual({
      strategy: "local",
      email: "ada@example.com",
      password: "correct horse",
    });
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });

  it("shows a NotAuthenticated error in a form-level alert", async () => {
    const { fetchMock, onSuccess } = await setup();
    fetchMock.mockResolvedValueOnce(errorResponse("NotAuthenticated", 401, "Invalid login"));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid login");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("maps Unprocessable field errors onto the matching field", async () => {
    const { fetchMock } = await setup();
    fetchMock.mockResolvedValueOnce(
      errorResponse("Unprocessable", 422, "Validation failed", { errors: [{ field: "/email", message: "is banned" }] }),
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "spam@example.com");
    await user.type(screen.getByLabelText("Password"), "whatever1");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    const email = screen.getByLabelText("Email");
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("is banned")).toBeTruthy();
    expect(email.getAttribute("aria-describedby")).toContain(screen.getByText("is banned").id);
  });

  it("is operable keyboard-only and blocks submit on empty required fields", async () => {
    const { fetchMock, onSuccess } = await setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: "a" }));
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
    await user.keyboard("{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.keyboard("ada@example.com");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Password"));
    await user.keyboard("secret-password");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Log in" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("has no axe violations, idle or showing errors", async () => {
    const { fetchMock, view } = await setup();
    await expectNoAxeViolations(view.container);

    fetchMock.mockResolvedValueOnce(errorResponse("NotAuthenticated", 401, "Invalid login"));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("alert");
    await expectNoAxeViolations(view.container);
  });
});
