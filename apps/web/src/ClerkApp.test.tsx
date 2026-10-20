import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClerkApp from "./ClerkApp";
import { api, isDemoSession, setDemoSession, setToken, setTokenProvider } from "./lib/api";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: async () => null }),
  useClerk: () => ({ signOut: vi.fn() }),
  AuthenticateWithRedirectCallback: () => null,
}));
vi.mock("./App", () => ({ default: () => <div>Demo workspace ready</div> }));
vi.mock("./components/AuthPage", () => ({ default: () => <div>Sign in</div> }));

describe("demo session verification", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    setTokenProvider(null);
    setToken("sandbox-token");
    setDemoSession(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("retains the session and offers retry after a temporary API failure", async () => {
    const me = vi.spyOn(api, "me")
      .mockRejectedValueOnce(new Error("Server is waking up"))
      .mockResolvedValueOnce({
        id: "u_dispatch", role: "dispatcher", organizationId: "org_demo",
        name: "Demo Dispatcher", email: "demo@example.com",
      });
    const view = render(<ClerkApp />);
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent("Server is waking up"));
    expect(isDemoSession()).toBe(true);
    expect(api.token()).toBe("sandbox-token");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(view.getByText("Demo workspace ready")).toBeInTheDocument());
    expect(me).toHaveBeenCalledTimes(2);
  });

  it("does not clear the session when verification fails after unmount", async () => {
    let rejectVerification!: (error: Error) => void;
    vi.spyOn(api, "me").mockImplementation(() => new Promise((_resolve, reject) => {
      rejectVerification = reject;
    }));
    const view = render(<ClerkApp />);
    view.unmount();
    rejectVerification(new Error("Navigation cancelled the request"));
    await Promise.resolve();
    expect(isDemoSession()).toBe(true);
    expect(api.token()).toBe("sandbox-token");
  });
});
