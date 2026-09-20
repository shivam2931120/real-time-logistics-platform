import type { Driver, ForecastSummary, Order } from "@routepulse/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const keyFor = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Produces a deliberately explainable demand forecast. It uses the last
 * 28 complete days, applies a weekday factor when enough observations exist,
 * and compares the result with a conservative per-driver capacity. This is
 * useful for planning without pretending to be an ML model.
 */
export function forecastDemand(
  orders: Order[],
  drivers: Driver[],
  horizonDays = 14,
  now = new Date(),
): ForecastSummary {
  const horizon = Math.min(30, Math.max(7, Math.round(horizonDays)));
  const baselineWindowDays = 28;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const baselineStart = new Date(today.getTime() - baselineWindowDays * DAY_MS);
  const baselineOrders = orders.filter((order) => {
    const created = new Date(order.createdAt).getTime();
    return created >= baselineStart.getTime() && created < today.getTime() + DAY_MS;
  });
  const dailyCounts = new Map<string, number>();
  const dailyRevenue = new Map<string, number>();
  for (let i = 0; i < baselineWindowDays; i += 1) {
    const date = new Date(baselineStart.getTime() + i * DAY_MS);
    dailyCounts.set(keyFor(date), 0);
    dailyRevenue.set(keyFor(date), 0);
  }
  baselineOrders.forEach((order) => {
    const key = keyFor(new Date(order.createdAt));
    if (!dailyCounts.has(key)) return;
    dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
    if (order.paymentStatus === "paid")
      dailyRevenue.set(key, (dailyRevenue.get(key) || 0) + order.amount);
  });
  const observedDays = [...dailyCounts.values()];
  const historicalAveragePerDay = observedDays.length
    ? +(observedDays.reduce((sum, count) => sum + count, 0) / observedDays.length).toFixed(1)
    : 0;
  const revenueOrders = baselineOrders.filter((order) => order.paymentStatus === "paid");
  const averageRevenuePerOrder = revenueOrders.length
    ? revenueOrders.reduce((sum, order) => sum + order.amount, 0) / revenueOrders.length
    : baselineOrders.length
      ? baselineOrders.reduce((sum, order) => sum + order.amount, 0) / baselineOrders.length
      : 0;
  const weekdayCounts = new Map<number, number[]>();
  for (const [key, count] of dailyCounts) {
    const weekday = new Date(`${key}T00:00:00.000Z`).getUTCDay();
    const values = weekdayCounts.get(weekday) || [];
    values.push(count);
    weekdayCounts.set(weekday, values);
  }
  const availableDrivers = drivers.filter((driver) => driver.status !== "offline").length;
  const perDriverCapacity = 8;
  const capacityPerDay = availableDrivers * perDriverCapacity;
  const points = Array.from({ length: horizon }, (_, index) => {
    const date = new Date(today.getTime() + (index + 1) * DAY_MS);
    const weekday = date.getUTCDay();
    const sameWeekday = weekdayCounts.get(weekday) || [];
    const weekdayAverage = sameWeekday.length
      ? sameWeekday.reduce((sum, value) => sum + value, 0) / sameWeekday.length
      : historicalAveragePerDay;
    const predictedOrders = Math.max(0, Math.round((weekdayAverage * 0.6 + historicalAveragePerDay * 0.4) * 10) / 10);
    const spread = Math.max(1, Math.ceil(Math.sqrt(Math.max(predictedOrders, 1))));
    const recommendedDrivers = capacityPerDay
      ? Math.max(0, Math.ceil(predictedOrders / perDriverCapacity))
      : predictedOrders > 0
        ? 1
        : 0;
    return {
      date: keyFor(date),
      predictedOrders,
      lowerBound: Math.max(0, Math.floor(predictedOrders - spread)),
      upperBound: Math.ceil(predictedOrders + spread),
      predictedRevenue: Math.round(predictedOrders * averageRevenuePerOrder),
      recommendedDrivers,
      capacityAlert: predictedOrders > capacityPerDay,
    };
  });
  const alerts: ForecastSummary["alerts"] = points
    .filter((point) => point.capacityAlert)
    .map((point) => ({
      date: point.date,
      message: `${point.predictedOrders} orders exceed the ${capacityPerDay}-delivery daily fleet capacity`,
      severity: "warning" as const,
    }));
  if (!baselineOrders.length)
    alerts.push({
      date: keyFor(today),
      message: "No recent order history is available; forecast confidence is limited",
      severity: "info",
    });
  const confidence: ForecastSummary["confidence"] =
    baselineOrders.length >= 40 ? "high" : baselineOrders.length >= 10 ? "medium" : "low";
  return {
    generatedAt: now.toISOString(),
    horizonDays: horizon,
    baselineWindowDays,
    historicalAveragePerDay,
    predictedOrders: +points.reduce((sum, point) => sum + point.predictedOrders, 0).toFixed(1),
    predictedRevenue: Math.round(points.reduce((sum, point) => sum + point.predictedRevenue, 0)),
    capacityPerDay,
    confidence,
    points,
    alerts,
  };
}
