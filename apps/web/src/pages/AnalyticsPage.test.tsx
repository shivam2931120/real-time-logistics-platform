import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary } from "@routepulse/shared";
import { api } from "../lib/api";
import { AnalyticsPage } from "./AnalyticsPage";

vi.mock("../lib/api", () => ({
  api: { analytics: vi.fn() },
}));

const summary: AnalyticsSummary = {
  windowDays: 7,
  totalOrders: 12,
  activeDrivers: 2,
  deliveriesToday: 3,
  onTimeRate: 94,
  completionRate: 75,
  paymentCollectionRate: 83,
  atRiskDeliveries: 1,
  openExceptions: 2,
  revenue: 5400,
  revenuePerDelivery: 600,
  averageDeliveryMinutes: 48,
  totalRouteKm: 92.4,
  averageRouteKm: 7.7,
  statusCounts: {
    pending: 1,
    assigned: 1,
    picked_up: 0,
    in_transit: 1,
    delivered: 9,
    failed: 0,
    cancelled: 0,
  },
  trend: [{ date: "2026-09-07", deliveries: 3, revenue: 1800 }],
  geofence: {
    arrivals: 8,
    departures: 7,
    currentlyInside: 1,
    averageDwellMinutes: 6.4,
  },
  priorityPerformance: [
    {
      priority: "standard",
      orders: 12,
      delivered: 9,
      onTimeRate: 94,
      averageDeliveryMinutes: 48,
    },
  ],
  driverPerformance: [
    {
      driverId: "driver-1",
      driverName: "Rohan Driver",
      assigned: 6,
      completed: 5,
      onTimeRate: 100,
      activeLoadKg: 8,
    },
  ],
  zonePerformance: [
    {
      zone: "Indiranagar",
      orders: 5,
      delivered: 4,
      onTimeRate: 100,
      revenue: 2400,
    },
  ],
};

describe("AnalyticsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders operational insights and changes reporting window", async () => {
    vi.mocked(api.analytics).mockResolvedValue({ ...summary, windowDays: 30 });
    const exportCsv = vi.fn(async () => undefined);
    const view = render(
      <AnalyticsPage analytics={summary} exportCsv={exportCsv} />,
    );
    expect(view.getByText("Geofence intelligence")).toBeInTheDocument();
    expect(view.getByText("Driver scorecard")).toBeInTheDocument();
    expect(view.getByText("Indiranagar")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "30D" }));
    await waitFor(() => expect(api.analytics).toHaveBeenCalledWith(30));
    fireEvent.click(view.getByRole("button", { name: /Export summary/i }));
    expect(exportCsv).toHaveBeenCalledWith(30);
  });
});
