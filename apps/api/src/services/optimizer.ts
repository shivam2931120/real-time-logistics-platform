import type { Address, Coordinate } from '@routepulse/shared';

export interface Stop extends Address { id: string; demandKg?: number }
export const haversineKm = (a: Coordinate, b: Coordinate) => {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(q));
};
const length = (start: Coordinate, route: Stop[]) => route.reduce((sum, stop, i) => sum + haversineKm(i ? route[i - 1]! : start, stop), 0);
export function optimizeRoute(start: Coordinate, stops: Stop[], capacityKg = Infinity) {
  const demand = stops.reduce((n, s) => n + (s.demandKg ?? 0), 0);
  if (demand > capacityKg) throw Object.assign(new Error(`Demand ${demand}kg exceeds ${capacityKg}kg capacity`), { status: 422 });
  const remaining = [...stops], route: Stop[] = [];
  let current = start;
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) if (haversineKm(current, remaining[i]!) < haversineKm(current, remaining[best]!)) best = i;
    const [next] = remaining.splice(best, 1); route.push(next!); current = next!;
  }
  let improved = true, loops = 0;
  while (improved && loops++ < 50) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) for (let j = i + 1; j < route.length; j++) {
      const candidate = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
      if (length(start, candidate) + 0.00001 < length(start, route)) { route.splice(0, route.length, ...candidate); improved = true; }
    }
  }
  const distanceKm = length(start, route);
  return { stops: route, distanceKm: +distanceKm.toFixed(2), durationMinutes: Math.ceil(distanceKm / 24 * 60 + route.length * 6), algorithm: 'nearest-neighbor+2-opt' as const };
}
