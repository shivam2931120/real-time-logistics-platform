import type {
  Coordinate,
  RouteOptimizationConstraints,
  RoutePlan,
  RoutePlanStop,
} from "@routepulse/shared";

export interface Stop extends RoutePlanStop {
  demandKg?: number;
}

export const haversineKm = (a: Coordinate, b: Coordinate) => {
  const r = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(q));
};

const length = (start: Coordinate, route: Stop[], returnToDepot = false) => {
  const travelled = route.reduce(
    (sum, stop, i) => sum + haversineKm(i ? route[i - 1]! : start, stop),
    0,
  );
  return returnToDepot && route.length
    ? travelled + haversineKm(route.at(-1)!, start)
    : travelled;
};

const priorityWeight: Record<NonNullable<Stop["priority"]>, number> = {
  standard: 0,
  express: 18,
  urgent: 42,
};

const numberOr = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? value! : fallback;

const routeError = (message: string) =>
  Object.assign(new Error(message), { status: 422 });

const parseStart = (value: string | undefined) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw routeError("Invalid route start time");
  return date;
};

const parseBoundary = (value: string | undefined, start: Date) => {
  if (!value) return undefined;
  const date = value.includes("T")
    ? new Date(value)
    : new Date(`${start.toISOString().slice(0, 10)}T${value}:00.000Z`);
  if (Number.isNaN(date.getTime())) throw routeError("Invalid driver shift end");
  if (!value.includes("T") && date.getTime() < start.getTime())
    date.setUTCDate(date.getUTCDate() + 1);
  return date;
};

type Simulation = {
  stops: RoutePlanStop[];
  distanceKm: number;
  durationMinutes: number;
  finishAt: Date;
  warnings: string[];
};

type NormalizedConstraints = Required<
  Pick<
    RouteOptimizationConstraints,
    "averageSpeedKph" | "serviceMinutes" | "respectTimeWindows" | "returnToDepot"
  >
> &
  Pick<
    RouteOptimizationConstraints,
    "startAt" | "maxRouteMinutes" | "shiftEnd"
  >;

const simulate = (
  start: Coordinate,
  route: Stop[],
  constraints: NormalizedConstraints,
): Simulation => {
  const startAt = parseStart(constraints.startAt);
  const speed = Math.max(5, constraints.averageSpeedKph);
  const serviceMs = constraints.serviceMinutes * 60_000;
  let cursor = startAt.getTime();
  let previous: Coordinate = start;
  let distanceKm = 0;
  const warnings: string[] = [];
  const stops: RoutePlanStop[] = [];

  for (const stop of route) {
    const legKm = haversineKm(previous, stop);
    distanceKm += legKm;
    cursor += (legKm / speed) * 3_600_000;
    const windowStart = stop.deliveryWindowStart
      ? new Date(stop.deliveryWindowStart)
      : undefined;
    let waitMinutes = 0;
    if (
      constraints.respectTimeWindows &&
      windowStart &&
      !Number.isNaN(windowStart.getTime()) &&
      windowStart.getTime() > cursor
    ) {
      waitMinutes = (windowStart.getTime() - cursor) / 60_000;
      cursor = windowStart.getTime();
    }
    const arrivalAt = new Date(cursor);
    const promisedAt = stop.promisedAt ? new Date(stop.promisedAt) : undefined;
    const lateRisk = Boolean(
      promisedAt && !Number.isNaN(promisedAt.getTime()) && cursor > promisedAt.getTime(),
    );
    if (lateRisk) warnings.push(`${stop.label} is outside its promised time`);
    cursor += serviceMs;
    stops.push({
      ...stop,
      arrivalAt: arrivalAt.toISOString(),
      departureAt: new Date(cursor).toISOString(),
      waitMinutes: Math.round(waitMinutes),
      lateRisk,
    });
    previous = stop;
  }
  if (constraints.returnToDepot && route.length) {
    const returnKm = haversineKm(previous, start);
    distanceKm += returnKm;
    cursor += (returnKm / speed) * 3_600_000;
  }
  const durationMinutes = Math.ceil((cursor - startAt.getTime()) / 60_000);
  const finishAt = new Date(cursor);
  if (
    constraints.maxRouteMinutes !== undefined &&
    durationMinutes > constraints.maxRouteMinutes
  )
    throw routeError(
      `Route takes ${durationMinutes} minutes and exceeds the ${constraints.maxRouteMinutes}-minute limit`,
    );
  const shiftEnd = parseBoundary(constraints.shiftEnd, startAt);
  if (shiftEnd && cursor > shiftEnd.getTime())
    throw routeError(
      `Route finishes at ${finishAt.toISOString()} after the driver's shift ends at ${shiftEnd.toISOString()}`,
    );
  return { stops, distanceKm, durationMinutes, finishAt, warnings };
};

const defaults = (
  constraints: RouteOptimizationConstraints = {},
): NormalizedConstraints => ({
  startAt: constraints.startAt,
  averageSpeedKph: numberOr(constraints.averageSpeedKph, 24),
  serviceMinutes: numberOr(constraints.serviceMinutes, 6),
  maxRouteMinutes: constraints.maxRouteMinutes,
  respectTimeWindows: constraints.respectTimeWindows ?? true,
  returnToDepot: constraints.returnToDepot ?? false,
  shiftEnd: constraints.shiftEnd,
});

/** Deterministic, dependency-free route planning fallback with ETA simulation. */
export function optimizeRoute(
  start: Coordinate,
  stops: Stop[],
  capacityKg = Infinity,
  constraints: RouteOptimizationConstraints = {},
): RoutePlan {
  const options = defaults(constraints);
  const demand = stops.reduce((n, s) => n + (s.demandKg ?? 0), 0);
  if (demand > capacityKg)
    throw routeError(`Demand ${demand}kg exceeds ${capacityKg}kg capacity`);
  const remaining = [...stops];
  const route: Stop[] = [];
  let current: Coordinate = start;
  let elapsedMs = parseStart(options.startAt).getTime();
  const speed = Math.max(5, options.averageSpeedKph);

  while (remaining.length) {
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i]!;
      const legKm = haversineKm(current, candidate);
      const arrivalMs = elapsedMs + (legKm / speed) * 3_600_000;
      const windowStart = candidate.deliveryWindowStart
        ? new Date(candidate.deliveryWindowStart).getTime()
        : Number.NaN;
      const waitMs =
        options.respectTimeWindows && Number.isFinite(windowStart)
          ? Math.max(0, windowStart - arrivalMs)
          : 0;
      const promisedMs = candidate.promisedAt
        ? new Date(candidate.promisedAt).getTime()
        : Number.NaN;
      const lateMinutes = Number.isFinite(promisedMs)
        ? Math.max(0, (arrivalMs + waitMs - promisedMs) / 60_000)
        : 0;
      const priority = candidate.priority
        ? priorityWeight[candidate.priority]
        : 0;
      const score = legKm + lateMinutes * 4 - priority;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    const [next] = remaining.splice(best, 1);
    route.push(next!);
    const legKm = haversineKm(current, next!);
    elapsedMs += (legKm / speed) * 3_600_000 + options.serviceMinutes * 60_000;
    current = next!;
  }

  const hasTimingConstraints = route.some(
    (stop) => stop.deliveryWindowStart || stop.promisedAt,
  );
  let improved = true;
  let loops = 0;
  while (!hasTimingConstraints && improved && loops++ < 50) {
    improved = false;
    for (let i = 0; i < route.length - 1; i += 1) {
      for (let j = i + 1; j < route.length; j += 1) {
        const candidate = [
          ...route.slice(0, i),
          ...route.slice(i, j + 1).reverse(),
          ...route.slice(j + 1),
        ];
        if (
          length(start, candidate, options.returnToDepot) + 0.00001 <
          length(start, route, options.returnToDepot)
        ) {
          route.splice(0, route.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  const simulation = simulate(start, route, options);
  const startAt = parseStart(options.startAt);
  return {
    stops: simulation.stops,
    distanceKm: +simulation.distanceKm.toFixed(2),
    durationMinutes: simulation.durationMinutes,
    algorithm: hasTimingConstraints
      ? "time-window+priority nearest-neighbor"
      : "nearest-neighbor+2-opt",
    startAt: startAt.toISOString(),
    finishAt: simulation.finishAt.toISOString(),
    returnToDepot: options.returnToDepot,
    warnings: [...new Set(simulation.warnings)],
  };
}
