import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthPage from "./AuthPage";

const signIn = {
  create: vi.fn(),
  prepareFirstFactor: vi.fn(),
  prepareSecondFactor: vi.fn(),
  attemptFirstFactor: vi.fn(),
  attemptSecondFactor: vi.fn(),
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
    signIn.prepareFirstFactor.mockReset();
    signIn.prepareSecondFactor.mockReset();
    signIn.attemptFirstFactor.mockReset();
    signIn.attemptSecondFactor.mockReset();
    setActiveSignIn.mockReset();
  });

  it("offers one public credential card for each role", () => {
    const view = render(<AuthPage />);

    expect(view.getByRole("heading", { name: "Try a role workspace" })).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: /Use credentials/ })).toHaveLength(4);
    fireEvent.click(view.getAllByRole("button", { name: /Use credentials/ })[2]);

    expect(view.getByLabelText("Email address")).toHaveValue(
      "chieftainofthedunedain.bgp+routepulse.driver@gmail.com",
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
    fireEvent.change(view.getByLabelText("Email address"), { target: { value: "driver@example.com" } });
    fireEvent.click(view.getByRole("button", { name: /^Continue$/ }));

    await waitFor(() =>
      expect(view.getByLabelText("Password")).toHaveValue(
        "RoutePulseDemo!Driver2026",
      ),
    );
  });

  it("completes a Clerk second-factor email-code challenge", async () => {
    signIn.create.mockResolvedValue({
      status: "needs_first_factor",
      supportedFirstFactors: [{ strategy: "password" }],
    });
    signIn.attemptFirstFactor.mockResolvedValue({
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "id-email" }],
    });
    signIn.prepareSecondFactor.mockResolvedValue({
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "id-email" }],
    });
    signIn.attemptSecondFactor.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_demo",
    });

    const view = render(<AuthPage />);
    fireEvent.click(view.getAllByRole("button", { name: /Use credentials/ })[2]);
    fireEvent.change(view.getByLabelText("Email address"), { target: { value: "driver@example.com" } });
    fireEvent.click(view.getByRole("button", { name: /^Continue$/ }));
    await waitFor(() => expect(view.getByLabelText("Password")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: /^Sign in$/ }));

    await waitFor(() => {
      expect(signIn.prepareSecondFactor).toHaveBeenCalledWith({
        strategy: "email_code",
        emailAddressId: "id-email",
      });
      expect(view.getByLabelText("Verification code")).toBeInTheDocument();
    });

    fireEvent.change(view.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(view.getByRole("button", { name: /Verify email/ }));

    await waitFor(() => expect(setActiveSignIn).toHaveBeenCalledWith({ session: "sess_demo" }));
    expect(signIn.attemptSecondFactor).toHaveBeenCalledWith({ strategy: "email_code", code: "123456" });
  });
});
