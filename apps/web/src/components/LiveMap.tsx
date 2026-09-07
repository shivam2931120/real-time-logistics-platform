import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  Layers3,
  LocateFixed,
  Maximize2,
  Route,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Driver, Order } from "@routepulse/shared";

type Point = { lat: number; lng: number };
type Props = {
  drivers: Driver[];
  orders: Order[];
  selectedOrderId?: string;
  selectedDriverId?: string;
  routeCoordinates?: Point[];
  onOrderSelect?: (order: Order) => void;
  onDriverSelect?: (driver: Driver) => void;
};
type RouteResponse = {
  routes?: Array<{ geometry?: { coordinates?: number[][] } }>;
};

const FALLBACK_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const activeOrder = (order: Order) =>
  !["delivered", "cancelled", "failed"].includes(order.status);
const asLine = (points: Point[]) =>
  points.map((point) => [point.lng, point.lat] as [number, number]);

async function roadRoute(points: Point[], signal: AbortSignal) {
  if (points.length < 2) return undefined;
  const coordinates = points
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
    { signal },
  );
  if (!response.ok) throw new Error("Routing service unavailable");
  const body = (await response.json()) as RouteResponse;
  const geometry = body.routes?.[0]?.geometry?.coordinates;
  return geometry?.filter(
    (point): point is [number, number] =>
      Array.isArray(point) &&
      point.length >= 2 &&
      typeof point[0] === "number" &&
      typeof point[1] === "number",
  );
}

export function LiveMap({
  drivers,
  orders,
  selectedOrderId,
  selectedDriverId,
  routeCoordinates,
  onOrderSelect,
  onDriverSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState("");
  const [locationState, setLocationState] = useState<
    "idle" | "locating" | "denied"
  >("idle");
  const [showDrivers, setShowDrivers] = useState(true);
  const [showStops, setShowStops] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [roadRoutes, setRoadRoutes] = useState<
    Record<string, [number, number][]>
  >({});
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

  useEffect(() => {
    const controller = new AbortController();
    const loadRoutes = async () => {
      const entries: Record<string, [number, number][]> = {};
      await Promise.all(
        activeOrders.slice(0, 16).map(async (order) => {
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
      return map.easeTo({ center: [77.606, 12.961], zoom: 11.5 });
    const bounds = coordinates.reduce(
      (value, point) => value.extend(point),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 700 });
  }, [activeOrders, drivers, routeCoordinates]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: import.meta.env.VITE_MAP_STYLE || FALLBACK_STYLE,
      center: [77.606, 12.961],
      zoom: 11.5,
      attributionControl: false,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.on("load", () => {
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
      setLoaded(true);
    });
    map.on("error", () => {
      setMapError(
        "Map tiles are taking too long to load. Controls and live data remain available.",
      );
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    mapRef.current = map;
    return () => {
      observer.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      userMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    if (showDrivers) {
      for (const driver of drivers) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `map-marker ${driver.status}${selectedDriverId === driver.id ? " selected" : ""}`;
        element.title = `${driver.name} · ${driver.status}`;
        element.setAttribute("aria-label", element.title);
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          onDriverSelect?.(driver);
        });
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = driver.name;
        const detail = document.createElement("span");
        detail.textContent = `${driver.status} · ${driver.capacityKg} kg · ${driver.vehiclePlate || "No plate"}`;
        popup.className = "map-popup";
        popup.append(title, detail);
        markersRef.current.push(
          new maplibregl.Marker({ element })
            .setLngLat([driver.location.lng, driver.location.lat])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(popup))
            .addTo(map),
        );
      }
    }
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
    drivers,
    fitOperations,
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
    if (!map || !loaded || !map.getLayer("delivery-routes")) return;
    map.setLayoutProperty(
      "delivery-routes",
      "visibility",
      showRoutes ? "visible" : "none",
    );
  }, [loaded, showRoutes]);

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

  const locate = () => {
    if (!navigator.geolocation) return setLocationState("denied");
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const map = mapRef.current;
        if (!map) return;
        const point: [number, number] = [
          position.coords.longitude,
          position.coords.latitude,
        ];
        if (!userMarkerRef.current) {
          const element = document.createElement("div");
          element.className = "user-location-marker";
          userMarkerRef.current = new maplibregl.Marker({ element })
            .setLngLat(point)
            .addTo(map);
        } else userMarkerRef.current.setLngLat(point);
        map.flyTo({ center: point, zoom: 14.5 });
        setLocationState("idle");
      },
      () => setLocationState("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="map-stage">
      <div
        ref={containerRef}
        className="live-map"
        aria-label="Live fleet and delivery map"
      />
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
          <Layers3 /> Stops
        </button>
        <button type="button" onClick={locate} title="Show my location">
          <LocateFixed />{" "}
          {locationState === "locating" ? "Locating…" : "My location"}
        </button>
      </div>
      {!loaded && (
        <div className="map-loading">
          <Crosshair />
          {mapError || "Loading map…"}
        </div>
      )}
      {locationState === "denied" && (
        <div className="map-notice">
          Location access is unavailable. Enable it in your browser and retry.
        </div>
      )}
      {loaded && !Object.keys(roadRoutes).length && activeOrders.length > 0 && (
        <div className="map-route-note">
          Road routing is loading; straight-line routes are shown temporarily.
        </div>
      )}
    </div>
  );
}
