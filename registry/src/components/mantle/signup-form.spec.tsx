import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createHarness, errorResponse, expectNoAxeViolations, jsonResponse } from "@/test/harness";
import { AuthProvider, useAuth } from "@/components/mantle/auth-provider";
import { SignupForm } from "@/components/mantle/signup-form";

function Status() {
  return <p data-testid="status">{useAuth().status}</p>;
}

async function setup(props: Parameters<typeof SignupForm>[0] = {}) {
  const harness = createHarness();
  const onSuccess = vi.fn();
  const view = harness.render(
    <AuthProvider usersService="accounts">
      <SignupForm onSuccess={onSuccess} {...props} />
      <Status />
    </AuthProvider>,
  );
  await screen.findByText("unauthenticated");
  return { ...harness, onSuccess, view };
}

async function fillAndSubmit(password = "long-enough-pw") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Ada");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("SignupForm", () => {
  it("creates the user through the configured service, then logs in", async () => {
    const { fetchMock, onSuccess } = await setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 7, email: "ada@example.com" }, 201))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "a", user: { id: 7 } }));

    await fillAndSubmit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "a" })));
    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(String(createUrl)).toBe("http://api.test/accounts");
    expect(JSON.parse(String(createInit?.body))).toEqual({
      email: "ada@example.com",
      password: "long-enough-pw",
      name: "Ada",
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://api.test/authentication");
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });

  it("shows a Conflict (duplicate email) in a form-level alert and does not log in", async () => {
    const { fetchMock, onSuccess } = await setup();
    fetchMock.mockResolvedValueOnce(errorResponse("Conflict", 409, "Email already exists"));

    await fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toBe("Email already exists");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("maps Unprocessable errors onto fields", async () => {
    const { fetchMock } = await setup();
    fetchMock.mockResolvedValueOnce(
      errorResponse("Unprocessable", 422, "Validation failed", {
        errors: [{ field: "/password", message: "must contain a digit" }],
      }),
    );

    await fillAndSubmit();

    expect(await screen.findByText("must contain a digit")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
  });

  it("enforces the minimum password length client-side", async () => {
    const { fetchMock } = await setup({ minPasswordLength: 12 });

    await fillAndSubmit("short");

    expect(await screen.findByText("Use at least 12 characters.")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits the name field with withName={false}", async () => {
    await setup({ withName: false });
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("is operable keyboard-only", async () => {
    const { fetchMock, onSuccess } = await setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 1 }, 201))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "a" }));
    const user = userEvent.setup();

    await user.tab();
    await user.keyboard("Ada");
    await user.tab();
    await user.keyboard("ada@example.com");
    await user.tab();
    await user.keyboard("long-enough-pw{Enter}");

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("has no axe violations, idle or showing errors", async () => {
    const { fetchMock, view } = await setup();
    await expectNoAxeViolations(view.container);

    fetchMock.mockResolvedValueOnce(errorResponse("Conflict", 409, "Email already exists"));
    await fillAndSubmit();
    await screen.findByRole("alert");
    await expectNoAxeViolations(view.container);
  });
});
