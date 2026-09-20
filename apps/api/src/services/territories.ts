import type { Coordinate, ServiceTerritory } from "@routepulse/shared";
import { serviceTerritories } from "../domain/store.js";

export function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]!;
    const prior = polygon[previous]!;
    const intersects =
      current.lng > point.lng !== prior.lng > point.lng &&
      point.lat < ((prior.lat - current.lat) * (point.lng - current.lng)) / (prior.lng - current.lng) + current.lat;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function activeTerritoriesFor(organizationId: string) {
  return serviceTerritories.filter((territory) => territory.organizationId === organizationId && territory.active);
}

export function validateServiceArea(organizationId: string, point: Coordinate) {
  const territories = activeTerritoriesFor(organizationId);
  if (!territories.length) return { enforced: false, inServiceArea: true, territories: [] as ServiceTerritory[] };
  const matching = territories.filter((territory) => pointInPolygon(point, territory.polygon));
  return { enforced: true, inServiceArea: matching.length > 0, territories: matching };
}
