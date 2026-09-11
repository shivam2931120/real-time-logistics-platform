import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthPage from "./AuthPage";

const signIn = {
  create: vi.fn(),
  prepareFirstFactor: vi.fn(),
  attemptFirstFactor: vi.fn(),
};
const setActiveSignIn = vi.fn();

vi.mock("@clerk/clerk-react", () => ({
  useSignIn: () => ({ isLoaded: true, signIn, setActive: setActiveSignIn }),
  useSignUp: () => ({ isLoaded: true, signUp: {}, setActive: vi.fn() }),
}));

describe("AuthPage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/#/sign-in");
    signIn.create.mockReset();
    setActiveSignIn.mockReset();
  });

  it("offers one public credential card for each role", () => {
    const view = render(<AuthPage />);

    expect(view.getByRole("heading", { name: "Try a role workspace" })).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: /Use credentials/ })).toHaveLength(4);
    fireEvent.click(view.getAllByRole("button", { name: /Use credentials/ })[2]);

    expect(view.getByLabelText("Email address")).toHaveValue(
      "demo.driver@routepulse.justshivamm.in",
    );
    expect(view.getByRole("status")).toHaveTextContent("Driver demo credentials loaded");
  });

  it("loads the selected password after Clerk accepts the identifier", async () => {
    signIn.create.mockResolvedValue({
      status: "needs_first_factor",
      supportedFirstFactors: [{ strategy: "password" }],
    });
    const view = render(<AuthPage />);
    fireEvent.click(view.getAllByRole("button", { name: /Use credentials/ })[2]);
    fireEvent.click(view.getByRole("button", { name: /^Continue$/ }));

    await waitFor(() =>
      expect(view.getByLabelText("Password")).toHaveValue(
        "RoutePulseDemo!Driver2026",
      ),
    );
  });
});
