import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingPage } from "./TrackingPage";

vi.mock("../components/LiveMap", () => ({
  LiveMap: () => <div aria-label="Live fleet and delivery map">Live map</div>,
}));
vi.mock("socket.io-client", () => ({
  io: () => ({ on: vi.fn(), close: vi.fn() }),
}));

describe("public tracking", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/track/RP-DEMO01");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              trackingCode: "RP-DEMO01",
              customerName: "Ananya",
              status: "in_transit",
              priority: "express",
              destination: "Koramangala",
              pickup: { label: "Hub", lat: 12.97, lng: 77.59 },
              dropoff: { label: "Koramangala", lat: 12.93, lng: 77.62 },
              driver: {
                name: "Meera",
                location: { lat: 12.94, lng: 77.61 },
                lastSeenAt: new Date().toISOString(),
              },
              promisedAt: new Date(Date.now() + 3600000).toISOString(),
              estimatedArrivalAt: new Date(Date.now() + 1800000).toISOString(),
              lateRisk: false,
              updatedAt: new Date().toISOString(),
              events: [
                {
                  type: "in_transit",
                  message: "Delivery is on the way",
                  createdAt: new Date().toISOString(),
                },
              ],
            }),
          }) as Response,
      ),
    );
  });
  it("renders privacy-safe live status, ETA, map, and timeline", async () => {
    const view = render(<TrackingPage />);
    await waitFor(() =>
      expect(view.getByText("RP-DEMO01")).toBeInTheDocument(),
    );
    expect(view.getByText("Meera")).toBeInTheDocument();
    expect(view.getByText("Estimated arrival")).toBeInTheDocument();
    expect(
      view.getByLabelText("Live fleet and delivery map"),
    ).toBeInTheDocument();
    expect(view.getByText("Delivery is on the way")).toBeInTheDocument();
  });
});
