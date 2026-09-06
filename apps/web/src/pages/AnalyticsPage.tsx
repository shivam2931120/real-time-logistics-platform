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
  CircleDollarSign,
  Clock3,
  PackageCheck,
  TrendingUp,
  Truck,
} from "lucide-react";
import type { AnalyticsSummary } from "@routepulse/shared";

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function AnalyticsPage({
  analytics,
}: {
  analytics: AnalyticsSummary | null;
}) {
  if (!analytics)
    return (
      <section className="panel empty-state">
        <TrendingUp />
        <strong>Analytics are loading</strong>
        <span>Operational totals will appear here.</span>
      </section>
    );
  const metrics = [
    ["Fleet online", analytics.activeDrivers, "Drivers accepting work", Truck],
    [
      "Delivered today",
      analytics.deliveriesToday,
      "Completed deliveries",
      PackageCheck,
    ],
    [
      "On-time rate",
      `${analytics.onTimeRate}%`,
      "Promise adherence",
      TrendingUp,
    ],
    [
      "Avg. delivery",
      `${analytics.averageDeliveryMinutes} min`,
      "Creation to completion",
      Clock3,
    ],
    [
      "Revenue",
      money(analytics.revenue),
      "Captured payments",
      CircleDollarSign,
    ],
  ] as const;
  const statuses = Object.entries(analytics.statusCounts).map(
    ([status, count]) => ({ status: status.replace("_", " "), count }),
  );
  return (
    <section className="analytics-page">
      <div className="analytics-kpis">
        {metrics.map(([label, value, caption, Icon]) => (
          <article className="panel" key={label}>
            <span>
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
              <span className="eyebrow">Last 7 days</span>
              <h3>Delivery volume</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={analytics.trend} margin={{ left: -18, right: 16 }}>
              <defs>
                <linearGradient id="analytics-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#9fca19" stopOpacity={0.38} />
                  <stop offset="95%" stopColor="#9fca19" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#e8ece6"
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
                stroke="#86ac10"
                strokeWidth={3}
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
                stroke="#e8ece6"
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
              <Bar dataKey="count" fill="#173025" radius={[0, 7, 7, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>
    </section>
  );
}
