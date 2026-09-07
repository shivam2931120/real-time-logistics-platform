import type { Coordinate } from "@routepulse/shared";

export type RoadRoute = {
  geometry: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
};

export type PlaceResult = Coordinate & {
  id: string;
  label: string;
  category: string;
};

type CacheEntry<T> = { value: T; expiresAt: number };

const routeCache = new Map<string, CacheEntry<RoadRoute>>();
const searchCache = new Map<string, CacheEntry<PlaceResult[]>>();
const ROUTE_TTL_MS = 5 * 60_000;
const SEARCH_TTL_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 250;

const cached = <T>(cache: Map<string, CacheEntry<T>>, key: string) => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

const remember = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
) => {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
};

const fetchWithTimeout = async (url: string, headers?: HeadersInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timeout);
  }
};

export async function roadRoute(points: Coordinate[]): Promise<RoadRoute> {
  const key = points
    .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
    .join(";");
  const existing = cached(routeCache, key);
  if (existing) return existing;
  const coordinates = points
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { accept: "application/json" },
    );
  } catch {
    throw Object.assign(new Error("Road routing service unavailable"), {
      status: 502,
    });
  }
  if (!response.ok)
    throw Object.assign(new Error("Road routing service unavailable"), {
      status: 502,
    });
  const body = (await response.json()) as {
    routes?: Array<{
      geometry?: { coordinates?: unknown };
      distance?: unknown;
      duration?: unknown;
    }>;
  };
  const route = body.routes?.[0];
  const geometry = Array.isArray(route?.geometry?.coordinates)
    ? route.geometry.coordinates.filter(
        (point): point is [number, number] =>
          Array.isArray(point) &&
          point.length >= 2 &&
          typeof point[0] === "number" &&
          typeof point[1] === "number",
      )
    : [];
  if (!geometry.length)
    throw Object.assign(new Error("Road routing returned no route"), {
      status: 502,
    });
  return remember(
    routeCache,
    key,
    {
      geometry,
      distanceMeters: typeof route?.distance === "number" ? route.distance : 0,
      durationSeconds: typeof route?.duration === "number" ? route.duration : 0,
    },
    ROUTE_TTL_MS,
  );
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const key = query.trim().toLowerCase();
  const existing = cached(searchCache, key);
  if (existing) return existing;
  const params = new URLSearchParams({
    q: query.trim(),
    format: "jsonv2",
    addressdetails: "1",
    limit: "6",
  });
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        accept: "application/json",
        "accept-language": "en",
        "user-agent": "RoutePulse/1.0 (logistics map search)",
      },
    );
  } catch {
    throw Object.assign(new Error("Address search service unavailable"), {
      status: 502,
    });
  }
  if (!response.ok)
    throw Object.assign(new Error("Address search service unavailable"), {
      status: 502,
    });
  const body = (await response.json()) as Array<{
    place_id?: number | string;
    display_name?: string;
    lat?: string;
    lon?: string;
    type?: string;
    category?: string;
  }>;
  const results = Array.isArray(body)
    ? body.flatMap((item) => {
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
        return [
          {
            id: String(item.place_id ?? `${lat},${lng}`),
            label: item.display_name || query.trim(),
            category: item.type || item.category || "place",
            lat,
            lng,
          },
        ];
      })
    : [];
  return remember(searchCache, key, results, SEARCH_TTL_MS);
}

export function clearMapGatewayCache() {
  routeCache.clear();
  searchCache.clear();
}
