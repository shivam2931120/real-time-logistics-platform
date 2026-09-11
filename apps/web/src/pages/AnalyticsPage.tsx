import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CircleDollarSign,
  Clock3,
  Download,
  Gauge,
  MapPinned,
  PackageCheck,
  ShieldCheck,
  TrendingUp,
  Truck,
} from "lucide-react";
import type { AnalyticsSummary } from "@routepulse/shared";
import { api } from "../lib/api";

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
const number = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);

export function AnalyticsPage({
  analytics,
  exportCsv,
}: {
  analytics: AnalyticsSummary | null;
  exportCsv: (days: number) => Promise<void>;
}) {
  const [summary, setSummary] = useState(analytics);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (analytics && days === 7) setSummary(analytics);
  }, [analytics, days]);

  const changeWindow = async (nextDays: number) => {
    setLoading(true);
    setError("");
    try {
      setSummary(await api.analytics(nextDays));
      setDays(nextDays);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load analytics",
      );
    } finally {
      setLoading(false);
    }
  };
  const download = async () => {
    setExporting(true);
    setError("");
    try {
      await exportCsv(days);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to export");
    } finally {
      setExporting(false);
    }
  };

  if (!summary)
    return (
      <section className="panel empty-state">
        <TrendingUp />
        <strong>Analytics are loading</strong>
        <span>Operational totals will appear here.</span>
      </section>
    );

  const metrics = [
    [
      "Total orders",
      summary.totalOrders,
      `${days}-day network volume`,
      PackageCheck,
    ],
    [
      "Completion",
      `${summary.completionRate}%`,
      "Orders successfully delivered",
      Gauge,
    ],
    ["On-time rate", `${summary.onTimeRate}%`, "Promise adherence", TrendingUp],
    [
      "Payment rate",
      `${summary.paymentCollectionRate}%`,
      "Paid order coverage",
      CircleDollarSign,
    ],
    ["At risk", summary.atRiskDeliveries, "Active SLA exposure", AlertTriangle],
    [
      "Open exceptions",
      summary.openExceptions,
      "Needs operations action",
      ShieldCheck,
    ],
    [
      "Route distance",
      `${number(summary.totalRouteKm)} km`,
      "Direct network kilometres",
      MapPinned,
    ],
    [
      "Revenue",
      money(summary.revenue),
      `${money(summary.revenuePerDelivery)} per delivery`,
      CircleDollarSign,
    ],
  ] as const;
  const statuses = Object.entries(summary.statusCounts).map(
    ([status, count]) => ({ status: status.replace("_", " "), count }),
  );
  const activeTrend = summary.trend;
  const comparison = summary.comparison;
  const deltaLabel = (value: number, suffix = "%") =>
    `${value > 0 ? "+" : ""}${value}${suffix}`;

  return (
    <section className="analytics-page">
      <div className="page-toolbar analytics-toolbar">
        <div>
          <span className="eyebrow">Network intelligence</span>
          <h1>Operational analytics</h1>
          <p>Tenant-scoped SLA, route, payment and geofence performance.</p>
        </div>
        <div className="analytics-actions">
          <div className="range-switch" aria-label="Analytics reporting window">
            {[7, 30, 90].map((value) => (
              <button
                type="button"
                className={days === value ? "active" : ""}
                key={value}
                disabled={loading}
                onClick={() => void changeWindow(value)}
              >
                {value}D
              </button>
            ))}
          </div>
          <button
            className="button ghost"
            disabled={exporting || loading}
            onClick={() => void download()}
          >
            <Download /> {exporting ? "Exporting…" : "Export summary"}
          </button>
        </div>
      </div>
      {error && <p className="inline-notice warning">{error}</p>}
      {comparison && (
        <div className="analytics-comparison" aria-label="Period comparison">
          <span>Compared with the previous {comparison.previousWindowDays} days</span>
          <strong>Orders {deltaLabel(comparison.ordersDeltaPct)}</strong>
          <strong>Revenue {deltaLabel(comparison.revenueDeltaPct)}</strong>
          <strong>On-time {deltaLabel(comparison.onTimeRateDelta, " pts")}</strong>
          <strong>Completion {deltaLabel(comparison.completionRateDelta, " pts")}</strong>
        </div>
      )}
      <div className="analytics-kpis analytics-kpis-extended">
        {metrics.map(([label, value, caption, Icon]) => (
          <article className="panel" key={label}>
            <span className={label === "At risk" ? "metric-warning" : ""}>
              <Icon />
            </span>
            <div>
              <small>{label}</small>
              <strong>{value}</strong>
              <p>{caption}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="analytics-charts">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Last {days} days</span>
              <h3>Daily completed deliveries</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={activeTrend} margin={{ left: -18, right: 16 }}>
              <defs>
                <linearGradient id="analytics-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.38} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#253142"
              />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => value.slice(5)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="deliveries"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#analytics-area)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Pipeline</span>
              <h3>Delivery status</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={statuses}
              layout="vertical"
              margin={{ left: 18, right: 24 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                horizontal={false}
                stroke="#253142"
              />
              <XAxis
                type="number"
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="status"
                width={76}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>

      <div className="analytics-insights">
        <article className="panel geofence-analytics">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Location operations</span>
              <h3>Geofence intelligence</h3>
            </div>
            <ShieldCheck />
          </div>
          <div className="geofence-metrics">
            <div>
              <strong>{summary.geofence.arrivals}</strong>
              <small>Arrivals</small>
            </div>
            <div>
              <strong>{summary.geofence.departures}</strong>
              <small>Departures</small>
            </div>
            <div>
              <strong>{summary.geofence.currentlyInside}</strong>
              <small>Currently inside</small>
            </div>
            <div>
              <strong>{summary.geofence.averageDwellMinutes} min</strong>
              <small>Average dwell</small>
            </div>
          </div>
        </article>
        <article className="panel priority-analytics">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Service quality</span>
              <h3>On-time rate by priority</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={summary.priorityPerformance}
              margin={{ left: -12, right: 18 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#253142"
              />
              <XAxis dataKey="priority" axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar
                dataKey="onTimeRate"
                name="On-time %"
                fill="#22c55e"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>

      <div className="analytics-tables">
        <article className="panel analytics-table">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Fleet performance</span>
              <h3>Driver scorecard</h3>
            </div>
            <Truck />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Assigned</th>
                  <th>Completed</th>
                  <th>On time</th>
                  <th>Active load</th>
                </tr>
              </thead>
              <tbody>
                {summary.driverPerformance.map((driver) => (
                  <tr key={driver.driverId}>
                    <td>
                      <strong>{driver.driverName}</strong>
                    </td>
                    <td>{driver.assigned}</td>
                    <td>{driver.completed}</td>
                    <td>
                      <span className="technical-badge success">
                        {driver.onTimeRate}%
                      </span>
                    </td>
                    <td>{driver.activeLoadKg} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel analytics-table">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Area performance</span>
              <h3>Delivery zones</h3>
            </div>
            <MapPinned />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Orders</th>
                  <th>Delivered</th>
                  <th>On time</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {summary.zonePerformance.map((zone) => (
                  <tr key={zone.zone}>
                    <td>
                      <strong>{zone.zone}</strong>
                    </td>
                    <td>{zone.orders}</td>
                    <td>{zone.delivered}</td>
                    <td>{zone.onTimeRate}%</td>
                    <td>{money(zone.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <div className="analytics-footnotes">
        <span>
          <Clock3 /> Average delivery {summary.averageDeliveryMinutes} min
        </span>
        <span>
          <MapPinned /> Average direct route {summary.averageRouteKm} km
        </span>
        <span>
          <Truck /> {summary.activeDrivers} drivers online
        </span>
      </div>
    </section>
  );
}
