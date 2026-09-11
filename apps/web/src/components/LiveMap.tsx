import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Crosshair,
  History,
  Layers3,
  LocateFixed,
  MapPin,
  Maximize2,
  Route,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Driver, Order } from "@routepulse/shared";
import { api, type MapSearchResult } from "../lib/api";
import {
  readCurrentLocation,
  watchLocation,
  type LocationReading,
} from "../lib/geolocation";

type Point = { lat: number; lng: number };
type Props = {
  drivers: Driver[];
  orders: Order[];
  selectedOrderId?: string;
  selectedDriverId?: string;
  routeCoordinates?: Point[];
  geofenceRadiusMeters?: number;
  onOrderSelect?: (order: Order) => void;
  onDriverSelect?: (driver: Driver) => void;
};
const FALLBACK_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_MAP_CENTER: [number, number] = [77.606, 12.961];
const STALE_AFTER_MS = 2 * 60_000;
const activeOrder = (order: Order) =>
  !["delivered", "cancelled", "failed"].includes(order.status);
const asLine = (points: Point[]) =>
  points.map((point) => [point.lng, point.lat] as [number, number]);
const isStale = (driver: Driver, timestamp = Date.now()) =>
  driver.status !== "offline" &&
  timestamp - new Date(driver.lastSeenAt).getTime() > STALE_AFTER_MS;
const distanceMeters = (a: Point, b: Point) => {
  const radius = 6_371_000;
  const radians = Math.PI / 180;
  const latitude = (b.lat - a.lat) * radians;
  const longitude = (b.lng - a.lng) * radians;
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(longitude / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
};
const circleRing = (center: Point, radiusMeters: number) => {
  const ring: Array<[number, number]> = [];
  const latitudeRadius = radiusMeters / 111_320;
  const longitudeRadius =
    radiusMeters /
    Math.max(1, 111_320 * Math.cos((center.lat * Math.PI) / 180));
  for (let index = 0; index <= 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    ring.push([
      center.lng + Math.cos(angle) * longitudeRadius,
      center.lat + Math.sin(angle) * latitudeRadius,
    ]);
  }
  return ring;
};

async function roadRoute(points: Point[], signal: AbortSignal) {
  if (points.length < 2) return undefined;
  return (await api.mapRoute(points, signal)).geometry;
}

export function LiveMap({
  drivers,
  orders,
  selectedOrderId,
  selectedDriverId,
  routeCoordinates,
  geofenceRadiusMeters = 150,
  onOrderSelect,
  onDriverSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const locationWatchRef = useRef<number | null>(null);
  const autoLocatedRef = useRef(false);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  const trailsRef = useRef<Record<string, Array<[number, number]>>>({});
  const lastTrailPointRef = useRef<Record<string, string>>({});
  const ordersRef = useRef(orders);
  const onOrderSelectRef = useRef(onOrderSelect);
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState("");
  const [mapAttempt, setMapAttempt] = useState(0);
  const [locationState, setLocationState] = useState<
    "idle" | "locating" | "ready" | "error"
  >("idle");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<number | null>(
    null,
  );
  const [locationMessage, setLocationMessage] = useState("");
  const [showDrivers, setShowDrivers] = useState(true);
  const [showStops, setShowStops] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showGeofences, setShowGeofences] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [roadRoutes, setRoadRoutes] = useState<
    Record<string, [number, number][]>
  >({});
  const [clock, setClock] = useState(Date.now());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MapSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const activeOrders = useMemo(() => orders.filter(activeOrder), [orders]);
  const routeKey = useMemo(
    () =>
      activeOrders
        .map(
          (order) =>
            `${order.id}:${order.pickup.lat},${order.pickup.lng}:${order.dropoff.lat},${order.dropoff.lng}`,
        )
        .join("|"),
    [activeOrders],
  );

  const renderUserLocation = useCallback(
    (reading: LocationReading, recenter: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      const point: [number, number] = [reading.lng, reading.lat];
      if (!userMarkerRef.current) {
        const element = document.createElement("div");
        element.className = "user-location-marker";
        element.setAttribute("aria-label", "Your current location");
        userMarkerRef.current = new maplibregl.Marker({ element }).addTo(map);
      }
      userMarkerRef.current.setLngLat(point);
      const accuracySource = map.getSource("user-location-accuracy") as
        | maplibregl.GeoJSONSource
        | undefined;
      accuracySource?.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                circleRing(
                  { lat: reading.lat, lng: reading.lng },
                  Math.min(Math.max(reading.accuracy, 10), 100_000),
                ),
              ],
            },
          },
        ],
      });
      if (recenter) map.flyTo({ center: point, zoom: 15, duration: 700 });
    },
    [],
  );

  const applyLocation = useCallback(
    (reading: LocationReading, recenter: boolean) => {
      renderUserLocation(reading, recenter);
      setLocationAccuracy(reading.accuracy);
      setLocationUpdatedAt(reading.timestamp);
      setLocationMessage("");
      setLocationState("ready");
    },
    [renderUserLocation],
  );

  const reportLocationError = useCallback((message: string) => {
    setLocationState("error");
    setLocationMessage(message);
  }, []);

  const locate = useCallback(() => {
    setLocationState("locating");
    setLocationMessage("");
    void readCurrentLocation()
      .then((reading) => {
        applyLocation(reading, true);
        if (locationWatchRef.current === null) {
          locationWatchRef.current = watchLocation(
            (nextReading) => applyLocation(nextReading, false),
            reportLocationError,
          );
        }
      })
      .catch((error: unknown) => {
        reportLocationError(
          error instanceof Error ? error.message : "Location lookup failed.",
        );
      });
  }, [applyLocation, reportLocationError]);

  useEffect(() => {
    ordersRef.current = orders;
    onOrderSelectRef.current = onOrderSelect;
  }, [onOrderSelect, orders]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadRoutes = async () => {
      const entries: Record<string, [number, number][]> = {};
      const routeOrders = activeOrders.slice(0, 16);
      for (let index = 0; index < routeOrders.length; index += 3) {
        await Promise.all(
          routeOrders.slice(index, index + 3).map(async (order) => {
            try {
              const route = await roadRoute(
                [order.pickup, order.dropoff],
                controller.signal,
              );
              if (route?.length) entries[order.id] = route;
            } catch {
              // Keep the straight-line fallback when OSRM is rate-limited/offline.
            }
          }),
        );
        if (controller.signal.aborted) return;
      }
      const optimizedCoordinates = routeCoordinates;
      if (optimizedCoordinates && optimizedCoordinates.length > 1) {
        try {
          const route = await roadRoute(
            optimizedCoordinates,
            controller.signal,
          );
          if (route?.length) entries["optimized-route"] = route;
        } catch {
          // Keep the optimized stop sequence as a fallback line.
        }
      }
      if (!controller.signal.aborted) setRoadRoutes(entries);
    };
    void loadRoutes();
    return () => controller.abort();
  }, [activeOrders, routeCoordinates, routeKey]);

  const fitOperations = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const coordinates = [
      ...drivers.map(
        (driver) =>
          [driver.location.lng, driver.location.lat] as [number, number],
      ),
      ...activeOrders.flatMap((order) => [
        [order.pickup.lng, order.pickup.lat] as [number, number],
        [order.dropoff.lng, order.dropoff.lat] as [number, number],
      ]),
      ...(routeCoordinates ?? []).map(
        (point) => [point.lng, point.lat] as [number, number],
      ),
    ];
    if (!coordinates.length)
      return map.easeTo({ center: DEFAULT_MAP_CENTER, zoom: 11.5 });
    const bounds = coordinates.reduce(
      (value, point) => value.extend(point),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 700 });
  }, [activeOrders, drivers, routeCoordinates]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    setLoaded(false);
    setMapError("");
    fittedRef.current = false;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: import.meta.env.VITE_MAP_STYLE || FALLBACK_STYLE,
        center: DEFAULT_MAP_CENTER,
        zoom: 11.5,
        attributionControl: false,
      });
    } catch {
      setMapError(
        "Map rendering is unavailable. Enable hardware acceleration or try another browser. Delivery lists remain available.",
      );
      return;
    }
    const loadTimeout = window.setTimeout(
      () =>
        setMapError(
          "The map provider is taking too long to respond. Check your connection or retry the map.",
        ),
      25000,
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.on("load", () => {
      window.clearTimeout(loadTimeout);
      setMapError("");
      map.addSource("geofences", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("user-location-accuracy", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
      map.addLayer({
        id: "user-location-accuracy-fill",
        type: "fill",
        source: "user-location-accuracy",
        paint: { "fill-color": "#06b6d4", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "user-location-accuracy-line",
        type: "line",
        source: "user-location-accuracy",
        paint: {
          "line-color": "#06b6d4",
          "line-width": 1.5,
          "line-opacity": 0.55,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "geofence-fill",
        type: "fill",
        source: "geofences",
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["get", "inside"], false],
            "#22c55e",
            ["==", ["get", "kind"], "pickup"],
            "#a78bfa",
            "#06b6d4",
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["get", "inside"], false],
            0.2,
            0.09,
          ],
        },
      });
      map.addLayer({
        id: "geofence-line",
        type: "line",
        source: "geofences",
        paint: {
          "line-color": [
            "case",
            ["boolean", ["get", "inside"], false],
            "#22c55e",
            ["==", ["get", "kind"], "pickup"],
            "#a78bfa",
            "#06b6d4",
          ],
          "line-width": [
            "case",
            ["boolean", ["get", "selected"], false],
            3,
            1.5,
          ],
          "line-opacity": 0.82,
          "line-dasharray": [3, 2],
        },
      });
      map.addSource("delivery-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "delivery-routes",
        type: "line",
        source: "delivery-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["boolean", ["get", "selected"], false],
            "#06b6d4",
            ["boolean", ["get", "lateRisk"], false],
            "#f59e0b",
            ["==", ["get", "status"], "delivered"],
            "#22c55e",
            "#2563eb",
          ],
          "line-width": ["case", ["boolean", ["get", "selected"], false], 5, 3],
          "line-opacity": 0.78,
          "line-dasharray": [2, 1.5],
        },
      });
      map.addSource("driver-trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "driver-trails",
        type: "line",
        source: "driver-trails",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#a78bfa",
          "line-width": 2,
          "line-opacity": 0.72,
          "line-dasharray": [1, 1.5],
        },
      });
      map.addSource("delivery-clusters", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });
      map.addLayer({
        id: "delivery-cluster-circles",
        type: "circle",
        source: "delivery-clusters",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#06b6d4",
          "circle-radius": ["step", ["get", "point_count"], 17, 20, 23, 50, 29],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#020304",
        },
      });
      map.addLayer({
        id: "delivery-cluster-count",
        type: "symbol",
        source: "delivery-clusters",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
        },
        paint: { "text-color": "#020304" },
      });
      map.addLayer({
        id: "delivery-cluster-point",
        type: "circle",
        source: "delivery-clusters",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "case",
            ["boolean", ["get", "lateRisk"], false],
            "#f59e0b",
            ["==", ["get", "priority"], "urgent"],
            "#ef4444",
            "#2563eb",
          ],
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "delivery-cluster-circles", async (event) => {
        const feature = map.queryRenderedFeatures(event.point, {
          layers: ["delivery-cluster-circles"],
        })[0];
        const clusterId = Number(feature?.properties?.cluster_id);
        if (!feature || !Number.isFinite(clusterId)) return;
        const source = map.getSource(
          "delivery-clusters",
        ) as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        if (feature.geometry.type !== "Point") return;
        map.easeTo({
          center: feature.geometry.coordinates as [number, number],
          zoom,
        });
      });
      map.on("click", "delivery-cluster-point", (event) => {
        const id = String(event.features?.[0]?.properties?.id || "");
        const order = ordersRef.current.find((item) => item.id === id);
        if (!order) return;
        if (onOrderSelectRef.current) onOrderSelectRef.current(order);
        else
          new maplibregl.Popup({ offset: 12 })
            .setLngLat([order.dropoff.lng, order.dropoff.lat])
            .setText(`${order.trackingCode} · ${order.dropoff.label}`)
            .addTo(map);
      });
      for (const layer of [
        "delivery-cluster-circles",
        "delivery-cluster-point",
      ]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      setLoaded(true);
    });
    map.on("error", () => {
      setMapError(
        "Some map resources could not load. Check your connection or retry the map.",
      );
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    mapRef.current = map;
    return () => {
      window.clearTimeout(loadTimeout);
      observer.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      userMarkerRef.current?.remove();
      searchMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [mapAttempt]);

  useEffect(() => {
    if (!loaded || autoLocatedRef.current || !navigator.permissions) return;
    autoLocatedRef.current = true;
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (permission.state === "granted") locate();
      })
      .catch(() => {
        // The user can always opt in explicitly with the My location control.
      });
  }, [loaded, locate]);

  useEffect(
    () => () => {
      if (locationWatchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchRef.current);
      }
      locationWatchRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    for (const driver of drivers) {
      const point: [number, number] = [
        driver.location.lng,
        driver.location.lat,
      ];
      const pointKey = `${point[0]},${point[1]}`;
      if (lastTrailPointRef.current[driver.id] !== pointKey) {
        const trail = trailsRef.current[driver.id] || [];
        trailsRef.current[driver.id] = [...trail, point].slice(-40);
        lastTrailPointRef.current[driver.id] = pointKey;
      }
    }
    if (showDrivers) {
      for (const driver of drivers) {
        const stale = isStale(driver, clock);
        const element = document.createElement("button");
        element.type = "button";
        element.className = `map-marker ${driver.status}${stale ? " stale" : ""}${selectedDriverId === driver.id ? " selected" : ""}`;
        element.title = `${driver.name} · ${stale ? "location stale" : driver.status}`;
        element.setAttribute("aria-label", element.title);
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          onDriverSelect?.(driver);
        });
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = driver.name;
        const detail = document.createElement("span");
        detail.textContent = `${stale ? "STALE GPS" : driver.status} · ${driver.capacityKg} kg · ${driver.vehiclePlate || "No plate"}`;
        const seen = document.createElement("small");
        seen.textContent = `Last seen ${new Date(driver.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        popup.className = "map-popup";
        popup.append(title, detail, seen);
        markersRef.current.push(
          new maplibregl.Marker({ element })
            .setLngLat([driver.location.lng, driver.location.lat])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(popup))
            .addTo(map),
        );
      }
    }
    const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
    const geofenceFeatures = activeOrders.flatMap((order) =>
      (["pickup", "dropoff"] as const).map((kind) => {
        const center = order[kind];
        const driver = order.assignedDriverId
          ? driverById.get(order.assignedDriverId)
          : undefined;
        return {
          type: "Feature" as const,
          properties: {
            id: `${order.id}:${kind}`,
            orderId: order.id,
            kind,
            inside: Boolean(
              driver &&
              distanceMeters(driver.location, center) <= geofenceRadiusMeters,
            ),
            selected: order.id === selectedOrderId,
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [circleRing(center, geofenceRadiusMeters)],
          },
        };
      }),
    );
    const geofenceSource = map.getSource("geofences") as
      maplibregl.GeoJSONSource | undefined;
    geofenceSource?.setData({
      type: "FeatureCollection",
      features: geofenceFeatures,
    });
    const trailSource = map.getSource("driver-trails") as
      maplibregl.GeoJSONSource | undefined;
    trailSource?.setData({
      type: "FeatureCollection",
      features: drivers.flatMap((driver) => {
        const coordinates = trailsRef.current[driver.id] || [];
        return coordinates.length > 1
          ? [
              {
                type: "Feature" as const,
                properties: { driverId: driver.id, name: driver.name },
                geometry: { type: "LineString" as const, coordinates },
              },
            ]
          : [];
      }),
    });
    if (showStops) {
      for (const order of activeOrders) {
        const pickup = document.createElement("button");
        pickup.type = "button";
        pickup.className = `pickup-marker${selectedOrderId === order.id ? " selected" : ""}`;
        pickup.textContent = "A";
        pickup.title = `Pickup · ${order.pickup.label}`;
        pickup.setAttribute("aria-label", pickup.title);
        pickup.addEventListener("click", (event) => {
          event.stopPropagation();
          onOrderSelect?.(order);
        });
        markersRef.current.push(
          new maplibregl.Marker({ element: pickup })
            .setLngLat([order.pickup.lng, order.pickup.lat])
            .addTo(map),
        );
        if (activeOrders.length > 12) continue;
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = `stop-marker ${order.priority}${selectedOrderId === order.id ? " selected" : ""}`;
        stop.textContent = order.priority === "urgent" ? "!" : "B";
        stop.title = `${order.trackingCode} · ${order.dropoff.label}`;
        stop.setAttribute("aria-label", stop.title);
        stop.addEventListener("click", (event) => {
          event.stopPropagation();
          onOrderSelect?.(order);
        });
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = order.trackingCode;
        const detail = document.createElement("span");
        detail.textContent = `${order.customerName} · ${order.dropoff.label}`;
        const eta = document.createElement("small");
        eta.textContent = order.estimatedArrivalAt
          ? `ETA ${new Date(order.estimatedArrivalAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${order.lateRisk ? " · AT RISK" : ""}`
          : `Status ${order.status.replace("_", " ")}`;
        popup.className = "map-popup";
        popup.append(title, detail, eta);
        markersRef.current.push(
          new maplibregl.Marker({ element: stop })
            .setLngLat([order.dropoff.lng, order.dropoff.lat])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(popup))
            .addTo(map),
        );
      }
    }
    const clusterSource = map.getSource("delivery-clusters") as
      maplibregl.GeoJSONSource | undefined;
    clusterSource?.setData({
      type: "FeatureCollection",
      features:
        activeOrders.length > 12
          ? activeOrders.map((order) => ({
              type: "Feature" as const,
              properties: {
                id: order.id,
                priority: order.priority,
                lateRisk: !!order.lateRisk,
              },
              geometry: {
                type: "Point" as const,
                coordinates: [order.dropoff.lng, order.dropoff.lat],
              },
            }))
          : [],
    });
    const source = map.getSource("delivery-routes") as
      maplibregl.GeoJSONSource | undefined;
    if (source) {
      const orderRoutes = activeOrders.map((order) => ({
        type: "Feature" as const,
        properties: {
          id: order.id,
          selected: order.id === selectedOrderId,
          status: order.status,
          lateRisk: !!order.lateRisk,
        },
        geometry: {
          type: "LineString" as const,
          coordinates:
            roadRoutes[order.id] ?? asLine([order.pickup, order.dropoff]),
        },
      }));
      const optimizedRoute =
        routeCoordinates && routeCoordinates.length > 1
          ? [
              {
                type: "Feature" as const,
                properties: {
                  id: "optimized-route",
                  selected: true,
                  status: "in_transit",
                  lateRisk: false,
                },
                geometry: {
                  type: "LineString" as const,
                  coordinates:
                    roadRoutes["optimized-route"] ?? asLine(routeCoordinates),
                },
              },
            ]
          : [];
      source.setData({
        type: "FeatureCollection",
        features: [...orderRoutes, ...optimizedRoute],
      });
    }
    if (!fittedRef.current && (drivers.length || activeOrders.length)) {
      fittedRef.current = true;
      fitOperations();
    }
  }, [
    activeOrders,
    clock,
    drivers,
    fitOperations,
    geofenceRadiusMeters,
    loaded,
    onDriverSelect,
    onOrderSelect,
    roadRoutes,
    selectedDriverId,
    selectedOrderId,
    routeCoordinates,
    showDrivers,
    showStops,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const visibility = (value: boolean) => (value ? "visible" : "none");
    if (map.getLayer("delivery-routes"))
      map.setLayoutProperty(
        "delivery-routes",
        "visibility",
        visibility(showRoutes),
      );
    for (const layer of ["geofence-fill", "geofence-line"]) {
      if (map.getLayer(layer))
        map.setLayoutProperty(layer, "visibility", visibility(showGeofences));
    }
    if (map.getLayer("driver-trails"))
      map.setLayoutProperty(
        "driver-trails",
        "visibility",
        visibility(showTrails),
      );
    for (const layer of [
      "delivery-cluster-circles",
      "delivery-cluster-count",
      "delivery-cluster-point",
    ]) {
      if (map.getLayer(layer))
        map.setLayoutProperty(layer, "visibility", visibility(showStops));
    }
  }, [loaded, showGeofences, showRoutes, showStops, showTrails]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const selected = selectedOrderId
      ? activeOrders.find((order) => order.id === selectedOrderId)?.dropoff
      : undefined;
    const driver = selectedDriverId
      ? drivers.find((item) => item.id === selectedDriverId)?.location
      : undefined;
    const point = selected || driver;
    if (point)
      map.flyTo({ center: [point.lng, point.lat], zoom: 13.5, duration: 500 });
  }, [activeOrders, drivers, loaded, selectedDriverId, selectedOrderId]);

  const search = async () => {
    if (searchQuery.trim().length < 3) return;
    setSearching(true);
    setSearchError("");
    try {
      setSearchResults(await api.mapSearch(searchQuery.trim()));
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error ? error.message : "Address search failed",
      );
    } finally {
      setSearching(false);
    }
  };

  const chooseSearchResult = (result: MapSearchResult) => {
    const map = mapRef.current;
    if (!map) return;
    searchMarkerRef.current?.remove();
    const element = document.createElement("div");
    element.className = "search-result-marker";
    searchMarkerRef.current = new maplibregl.Marker({ element })
      .setLngLat([result.lng, result.lat])
      .setPopup(new maplibregl.Popup({ offset: 18 }).setText(result.label))
      .addTo(map);
    map.flyTo({ center: [result.lng, result.lat], zoom: 14, duration: 650 });
    searchMarkerRef.current.togglePopup();
    setSearchResults([]);
  };

  const operationalState = useMemo(() => {
    const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
    const inside = activeOrders.filter((order) => {
      const driver = order.assignedDriverId
        ? driverById.get(order.assignedDriverId)
        : undefined;
      if (!driver) return false;
      const stop = order.status === "assigned" ? order.pickup : order.dropoff;
      return distanceMeters(driver.location, stop) <= geofenceRadiusMeters;
    }).length;
    return {
      live: drivers.filter(
        (driver) => driver.status !== "offline" && !isStale(driver, clock),
      ).length,
      stale: drivers.filter((driver) => isStale(driver, clock)).length,
      atRisk: activeOrders.filter((order) => order.lateRisk).length,
      inside,
    };
  }, [activeOrders, clock, drivers, geofenceRadiusMeters]);
  const locationAccuracyLabel = locationAccuracy
    ? locationAccuracy >= 1000
      ? `±${(locationAccuracy / 1000).toFixed(1)} km`
      : `±${Math.round(locationAccuracy)} m`
    : "";
  const locationStatusLabel =
    locationState === "ready"
      ? `GPS ${locationAccuracyLabel}`
      : locationState === "locating"
        ? "Locating…"
        : "My location";

  return (
    <div className="map-stage">
      <div
        ref={containerRef}
        className="live-map"
        aria-label="Live fleet and delivery map"
      />
      <form
        className="map-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Search aria-hidden="true" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search any address"
          aria-label="Search map address"
        />
        {searchQuery && (
          <button
            type="button"
            title="Clear map search"
            onClick={() => {
              setSearchQuery("");
              setSearchResults([]);
              setSearchError("");
              searchMarkerRef.current?.remove();
              searchMarkerRef.current = null;
            }}
          >
            <X />
          </button>
        )}
        <button type="submit" disabled={searching || searchQuery.length < 3}>
          {searching ? "…" : "Go"}
        </button>
        {(searchResults.length > 0 || searchError) && (
          <div className="map-search-results">
            {searchError && <p>{searchError}</p>}
            {searchResults.map((result) => (
              <button
                type="button"
                key={result.id}
                onClick={() => chooseSearchResult(result)}
              >
                <MapPin />
                <span>
                  <strong>{result.label.split(",")[0]}</strong>
                  <small>{result.label}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </form>
      <div className="map-tools" aria-label="Map controls">
        <button
          type="button"
          onClick={fitOperations}
          title="Fit all operations"
        >
          <Maximize2 /> Fit all
        </button>
        <button
          className={showRoutes ? "active" : ""}
          type="button"
          onClick={() => setShowRoutes((value) => !value)}
          title="Toggle road routes"
        >
          <Route /> Routes
        </button>
        <button
          className={showDrivers ? "active" : ""}
          type="button"
          onClick={() => setShowDrivers((value) => !value)}
          title="Toggle driver markers"
        >
          <Layers3 /> Drivers
        </button>
        <button
          className={showStops ? "active" : ""}
          type="button"
          onClick={() => setShowStops((value) => !value)}
          title="Toggle pickup and delivery stops"
        >
          <MapPin /> Stops
        </button>
        <button
          className={showGeofences ? "active" : ""}
          type="button"
          onClick={() => setShowGeofences((value) => !value)}
          title={`Toggle ${geofenceRadiusMeters} metre geofences`}
        >
          <ShieldCheck /> Geofences
        </button>
        <button
          className={showTrails ? "active" : ""}
          type="button"
          onClick={() => setShowTrails((value) => !value)}
          title="Toggle session driver trails"
        >
          <History /> Trails
        </button>
        <button
          type="button"
          onClick={locate}
          disabled={locationState === "locating"}
          title="Use a fresh, high-accuracy GPS reading"
        >
          <LocateFixed />{" "}
          {locationStatusLabel}
        </button>
      </div>
      <div className="map-telemetry" aria-label="Live map status">
        <span className="healthy">{operationalState.live} live</span>
        <span className={operationalState.inside ? "healthy" : ""}>
          {operationalState.inside} in geofence
        </span>
        <span className={operationalState.stale ? "warning" : ""}>
          {operationalState.stale} stale GPS
        </span>
        <span className={operationalState.atRisk ? "warning" : ""}>
          {operationalState.atRisk} at risk
        </span>
      </div>
      {!loaded && (
        <div className="map-loading" role="status">
          <Crosshair />
          {mapError || "Loading map…"}
          {mapError && (
            <button
              className="button ghost"
              onClick={() => setMapAttempt((value) => value + 1)}
            >
              Retry map
            </button>
          )}
        </div>
      )}
      {loaded && mapError && (
        <div className="map-notice" role="status">
          {mapError}{" "}
          <button onClick={() => setMapAttempt((value) => value + 1)}>
            Retry map
          </button>
        </div>
      )}
      {locationState === "error" && (
        <div className="map-notice">
          {locationMessage || "Location access is unavailable."} Use the browser
          address-bar permission control, then retry.
        </div>
      )}
      {locationState === "ready" && locationUpdatedAt && (
        <div className="map-location-status" role="status">
          <LocateFixed /> Current device location · {locationAccuracyLabel} ·
          updated {new Date(locationUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      {loaded && !Object.keys(roadRoutes).length && activeOrders.length > 0 && (
        <div className="map-route-note">
          <AlertTriangle /> Road routing is unavailable or still loading. Dashed
          lines show direct distances, not driving directions.
        </div>
      )}
    </div>
  );
}
