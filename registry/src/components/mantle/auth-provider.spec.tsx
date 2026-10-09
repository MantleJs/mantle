import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { AuthProvider, useAuth } from "@/components/mantle/auth-provider";

function Probe() {
  const { status, oauthError, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="error">{oauthError ?? ""}</p>
      <button type="button" onClick={() => void logout()}>
        Log out
      </button>
    </div>
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("AuthProvider", () => {
  it("restores a persisted session on mount", async () => {
    const harness = createHarness();
    await harness.client.setTokens({ accessToken: "persisted" });
    harness.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeTruthy();
  });

  it("consumes OAuth tokens from the URL fragment and strips them from the address bar", async () => {
    window.history.replaceState(null, "", "/login?next=home#accessToken=oauth-at&refreshToken=oauth-rt");
    const harness = createHarness();
    harness.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeTruthy();
    expect(harness.client.getAccessToken()).toBe("oauth-at");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?next=home");
  });

  it("surfaces an OAuth #error= redirect", async () => {
    window.history.replaceState(null, "", "/#error=access_denied");
    const harness = createHarness();
    harness.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeTruthy();
    expect(screen.getByTestId("error").textContent).toBe("access_denied");
    expect(window.location.hash).toBe("");
  });

  it("leaves the fragment alone with handleOAuthRedirect={false}", async () => {
    window.history.replaceState(null, "", "/#accessToken=x");
    const harness = createHarness();
    harness.render(
      <AuthProvider handleOAuthRedirect={false}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeTruthy();
    expect(window.location.hash).toBe("#accessToken=x");
  });

  it("goes back to unauthenticated on logout", async () => {
    const harness = createHarness();
    await harness.client.setTokens({ accessToken: "t" });
    harness.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    act(() => screen.getByRole("button", { name: "Log out" }).click());
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
  });

  it("throws a descriptive error when useAuth() has no provider", () => {
    const harness = createHarness();
    expect(() => harness.render(<Probe />)).toThrow(/within an <AuthProvider>/);
  });
});
