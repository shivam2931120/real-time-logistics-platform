import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import App from "./App";
import { api, setToken } from "./lib/api";
vi.mock("./components/LiveMap", () => ({
  LiveMap: () => (
    <div aria-label="Live fleet and delivery map">Operational map</div>
  ),
}));
describe("RoutePulse entry", () => {
  beforeEach(() => {
    localStorage.clear();
    setToken("");
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });
  it("offers role-based demo workspaces", () => {
    const view = render(<App />);
    expect(view.getByText("Every delivery.")).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: /Dispatch control/i }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: /Driver mobile/i }),
    ).toBeInTheDocument();
  });
  it("preserves the session and offers retry after a temporary API outage", async () => {
    setToken("existing-session");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Service temporarily unavailable" }),
            { status: 503 },
          ),
      ),
    );
    const view = render(<App />);
    expect(
      await view.findByRole("heading", { name: "Workspace could not load" }),
    ).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(api.token()).toBe("existing-session");
  });
  it("clears an invalid session and returns to sign-in on HTTP 401", async () => {
    setToken("expired-session");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Expired session" }), {
            status: 401,
          }),
      ),
    );
    const view = render(<App />);
    expect(
      await view.findByRole("button", { name: /Dispatch control/i }),
    ).toBeInTheDocument();
    expect(api.token()).toBe("");
  });
  it("recovers from a failed login instead of disabling every role", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );
    const view = render(<App />);
    fireEvent.click(view.getByRole("button", { name: /Dispatch control/i }));
    await waitFor(() =>
      expect(view.getByRole("alert")).toHaveTextContent("Failed to fetch"),
    );
    expect(
      view.getByRole("button", { name: /Dispatch control/i }),
    ).toBeEnabled();
  });
  it("opens the route planner as a real URL-backed page", async () => {
    const timestamp = new Date().toISOString();
    const user = {
      id: "u_admin",
      organizationId: "org_demo",
      name: "Aarav Admin",
      email: "admin@routepulse.demo",
      role: "admin",
    };
    const order = {
      id: "ord_1",
      organizationId: "org_demo",
      trackingCode: "RP-ROUTE1",
      customerName: "Mira",
      customerEmail: "mira@example.com",
      pickup: { label: "Origin Hub", lat: 12.97, lng: 77.59 },
      dropoff: { label: "Indiranagar", lat: 12.98, lng: 77.64 },
      packageWeightKg: 8,
      priority: "express",
      status: "pending",
      amount: 349,
      currency: "INR",
      paymentStatus: "unpaid",
      promisedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      events: [],
    };
    const driver = {
      id: "driver_1",
      userId: "u_driver",
      name: "Ravi",
      status: "available",
      capacityKg: 100,
      location: { lat: 12.96, lng: 77.6 },
      lastSeenAt: timestamp,
    };
    const analytics = {
      activeDrivers: 1,
      deliveriesToday: 0,
      onTimeRate: 100,
      revenue: 0,
      averageDeliveryMinutes: 0,
      statusCounts: {
        pending: 1,
        assigned: 0,
        picked_up: 0,
        in_transit: 0,
        delivered: 0,
        failed: 0,
        cancelled: 0,
      },
      trend: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.endsWith("/api/auth/demo")
          ? { token: "demo-token", user }
          : url.endsWith("/api/me")
            ? user
            : url.endsWith("/api/orders")
              ? [order]
              : url.endsWith("/api/drivers")
                ? [driver]
                : analytics;
        return { ok: true, json: async () => body } as Response;
      }),
    );
    const view = render(<App />);
    fireEvent.click(view.getByRole("button", { name: /Operations admin/i }));
    await waitFor(() =>
      expect(view.getByText("Your fleet is moving.")).toBeInTheDocument(),
    );
    fireEvent.click(view.getByRole("button", { name: /Route planner/i }));
    expect(window.location.pathname).toBe("/routes");
    expect(view.getByText("Build today's route")).toBeInTheDocument();
    expect(view.getByText("RP-ROUTE1")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const command = view.getByRole("dialog", { name: "Search RoutePulse" });
    fireEvent.change(within(command).getByLabelText("Search RoutePulse"), {
      target: { value: "fleet" },
    });
    fireEvent.click(within(command).getByRole("button", { name: /Fleet/ }));
    expect(window.location.pathname).toBe("/fleet");
  });
  it("shows customers only their delivery workspace", async () => {
    const user = {
      id: "u_customer",
      organizationId: "org_demo",
      name: "Kabir Customer",
      email: "customer@routepulse.demo",
      role: "customer",
    };
    const order = {
      id: "ord_1002",
      organizationId: "org_demo",
      trackingCode: "RP-DEMO02",
      customerName: "Kabir Customer",
      customerEmail: user.email,
      pickup: { label: "Origin Hub", lat: 12.97, lng: 77.59 },
      dropoff: { label: "Malleshwaram", lat: 13, lng: 77.56 },
      packageWeightKg: 9,
      priority: "standard",
      status: "pending",
      amount: 249,
      currency: "INR",
      paymentStatus: "unpaid",
      promisedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.endsWith("/api/auth/demo")
          ? { token: "demo-token", user }
          : url.endsWith("/api/me")
            ? user
            : [order];
        return { ok: true, json: async () => body } as Response;
      }),
    );
    const view = render(<App />);
    fireEvent.click(view.getByRole("button", { name: /Customer tracking/i }));
    await waitFor(() =>
      expect(view.getByText("Your deliveries, Kabir")).toBeInTheDocument(),
    );
    expect(view.getByText("RP-DEMO02")).toBeInTheDocument();
    expect(view.queryByText("New delivery")).not.toBeInTheDocument();
  });
});
