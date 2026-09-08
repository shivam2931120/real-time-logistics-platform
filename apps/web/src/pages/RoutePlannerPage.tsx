import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  GripVertical,
  Route,
  Sparkles,
  Truck,
} from "lucide-react";
import type { Driver, Order } from "@routepulse/shared";
import { api, type RoutePlan } from "../lib/api";
import { LiveMap } from "../components/LiveMap";

type PlannedStop = RoutePlan["stops"][number];

const distanceKm = (
  start: { lat: number; lng: number },
  stops: PlannedStop[],
) => {
  const points = [start, ...stops];
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    const lat = ((point.lat - previous.lat) * Math.PI) / 180;
    const lng = ((point.lng - previous.lng) * Math.PI) / 180;
    const a =
      Math.sin(lat / 2) ** 2 +
      Math.cos((previous.lat * Math.PI) / 180) *
        Math.cos((point.lat * Math.PI) / 180) *
        Math.sin(lng / 2) ** 2;
    return total + 6371 * 2 * Math.asin(Math.sqrt(a));
  }, 0);
};

export function RoutePlannerPage({
  drivers,
  orders,
  geofenceRadiusMeters,
}: {
  drivers: Driver[];
  orders: Order[];
  geofenceRadiusMeters?: number;
}) {
  const candidates = useMemo(
    () =>
      orders.filter(
        (order) => !["delivered", "cancelled", "failed"].includes(order.status),
      ),
    [orders],
  );
  const [driverId, setDriverId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [planStops, setPlanStops] = useState<PlannedStop[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initializedSelection = useRef(false);
  useEffect(() => {
    if (!driverId && drivers[0]) setDriverId(drivers[0].id);
  }, [driverId, drivers]);
  useEffect(() => {
    const seedSelection =
      !initializedSelection.current && candidates.length > 0;
    if (seedSelection) initializedSelection.current = true;
    setSelected((current) =>
      seedSelection
        ? candidates.slice(0, 6).map((order) => order.id)
        : current.filter((id) => candidates.some((order) => order.id === id)),
    );
  }, [candidates]);
  const driver = drivers.find((item) => item.id === driverId);
  const orderedSelectedOrders = selected
    .map((id) => candidates.find((order) => order.id === id))
    .filter((order): order is Order => Boolean(order));
  const selectedOrders = orderedSelectedOrders;
  const orderedCandidates = [
    ...orderedSelectedOrders,
    ...candidates.filter((order) => !selected.includes(order.id)),
  ];
  const demand = selectedOrders.reduce(
    (total, order) => total + order.packageWeightKg,
    0,
  );
  const capacity = driver?.capacityKg || 0;
  const overCapacity = Boolean(driver && demand > capacity);
  const utilization = capacity ? Math.round((demand / capacity) * 100) : 0;
  const optimize = async () => {
    if (!driverId || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      const nextPlan = await api.optimize(driverId, selected);
      setPlan(nextPlan);
      setPlanStops(nextPlan.stops);
    } catch (reason) {
      setPlan(null);
      setError(
        reason instanceof Error ? reason.message : "Unable to optimize route",
      );
    } finally {
      setBusy(false);
    }
  };
  const reorderSelected = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setSelected((current) => {
      const next = [...current];
      const sourceIndex = next.indexOf(sourceId);
      const targetIndex = next.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourceId);
      return next;
    });
    setPlan(null);
    setPlanStops([]);
  };
  const reorderPlan = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || !driver) return;
    const next = [...planStops];
    const sourceIndex = next.findIndex((stop) => stop.id === sourceId);
    const targetIndex = next.findIndex((stop) => stop.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    const distance = distanceKm(driver.location, next);
    setPlanStops(next);
    setPlan((current) =>
      current
        ? {
            ...current,
            stops: next,
            distanceKm: +distance.toFixed(2),
            durationMinutes: Math.ceil((distance / 24) * 60 + next.length * 6),
            algorithm: "manual drag order",
          }
        : current,
    );
  };
  return (
    <section className="planner-layout">
      <div className="panel planner-controls">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Capacity-aware planning</span>
            <h3>Build today&apos;s route</h3>
          </div>
          <Route />
        </div>
        <label className="field-label">
          Driver
          <select
            value={driverId}
            onChange={(event) => {
              setDriverId(event.target.value);
              setPlan(null);
              setPlanStops([]);
            }}
          >
            {drivers.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · {item.capacityKg} kg
              </option>
            ))}
          </select>
        </label>
        <div className="capacity-meter">
          <div>
            <span>Selected load</span>
            <strong>
              {demand.toFixed(1)} / {capacity} kg
            </strong>
          </div>
          <progress max={capacity || 1} value={demand} />
        </div>
        {overCapacity && (
          <p className="inline-notice warning" role="alert">
            This route is {demand - capacity} kg over vehicle capacity. Remove a
            stop before optimizing.
          </p>
        )}
        <div className="stop-picker">
          <div className="stop-picker-head">
            <strong>Delivery stops</strong>
            <button
              type="button"
              onClick={() =>
                (() => {
                  setSelected(
                    selected.length === candidates.length
                      ? []
                      : candidates.map((order) => order.id),
                  );
                  setPlan(null);
                  setPlanStops([]);
                })()
              }
            >
              {selected.length === candidates.length
                ? "Clear all"
                : "Select all"}
            </button>
          </div>
          <small className="route-edit-hint">
            Drag selected stops to reorder. With a checkbox focused, use Alt + ↑
            / ↓.
          </small>
          {orderedCandidates.map((order) => (
            <label
              key={order.id}
              draggable={selected.includes(order.id)}
              className={`${selected.includes(order.id) ? "selected" : ""}${draggingId === order.id ? " dragging" : ""}`}
              onDragStart={() => {
                if (selected.includes(order.id)) setDraggingId(order.id);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingId && selected.includes(order.id))
                  reorderSelected(draggingId, order.id);
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
            >
              <GripVertical className="drag-handle" aria-hidden="true" />
              <input
                type="checkbox"
                aria-label={`Include ${order.trackingCode} in route`}
                onKeyDown={(event) => {
                  if (
                    !event.altKey ||
                    !["ArrowUp", "ArrowDown"].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const index = selected.indexOf(order.id);
                  const target =
                    selected[index + (event.key === "ArrowUp" ? -1 : 1)];
                  if (index >= 0 && target) reorderSelected(order.id, target);
                }}
                checked={selected.includes(order.id)}
                onChange={() => {
                  setSelected((items) =>
                    items.includes(order.id)
                      ? items.filter((id) => id !== order.id)
                      : [...items, order.id],
                  );
                  setPlan(null);
                  setPlanStops([]);
                }}
              />
              <span>
                <strong>{order.trackingCode}</strong>
                <small>
                  {order.dropoff.label} · {order.packageWeightKg} kg
                </small>
              </span>
              <b className="stop-order">{selected.indexOf(order.id) + 1}</b>
              <b>{order.priority}</b>
            </label>
          ))}
          {selected.length < candidates.length && (
            <small className="route-edit-hint muted">
              Unselected deliveries remain available below the active sequence.
            </small>
          )}
        </div>
        {!drivers.length && (
          <p className="inline-notice">Add a driver before planning a route.</p>
        )}
        {!candidates.length && (
          <p className="inline-notice">
            No active deliveries are ready for routing.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={busy || !driverId || !selected.length || overCapacity}
          onClick={() => void optimize()}
        >
          <Sparkles />
          {busy ? "Optimizing…" : "Optimize route"}
        </button>
      </div>
      <div className="panel planner-map">
        <LiveMap
          drivers={driver ? [driver] : []}
          orders={selectedOrders}
          selectedDriverId={driverId}
          geofenceRadiusMeters={geofenceRadiusMeters}
          routeCoordinates={
            plan && driver ? [driver.location, ...planStops] : undefined
          }
        />
        {plan ? (
          <div className="route-result">
            <div>
              <Route />
              <span>
                <strong>{plan.distanceKm} km</strong>
                <small>
                  {plan.algorithm === "manual drag order"
                    ? "Manual sequence estimate"
                    : "Optimized distance"}
                </small>
              </span>
            </div>
            <div>
              <Clock3 />
              <span>
                <strong>{plan.durationMinutes} min</strong>
                <small>Estimated duration</small>
              </span>
            </div>
            <div>
              <Truck />
              <span>
                <strong>{utilization}%</strong>
                <small>Vehicle utilization</small>
              </span>
            </div>
            <ol>
              {planStops.map((stop, index) => (
                <li
                  key={stop.id}
                  draggable
                  className={draggingId === stop.id ? "dragging" : ""}
                  onDragStart={() => setDraggingId(stop.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (draggingId) reorderPlan(draggingId, stop.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{stop.label}</strong>
                    <small>{stop.demandKg || 0} kg delivery</small>
                  </div>
                  <GripVertical
                    className="route-drag-icon"
                    aria-label="Drag to reorder stop"
                  />
                  <CheckCircle2 />
                  <div className="stop-move-actions">
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`Move ${stop.label} up`}
                      onClick={() =>
                        reorderPlan(stop.id, planStops[index - 1].id)
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === planStops.length - 1}
                      aria-label={`Move ${stop.label} down`}
                      onClick={() =>
                        reorderPlan(stop.id, planStops[index + 1].id)
                      }
                    >
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="map-empty-overlay">
            <Route />
            <strong>Your optimized sequence will appear here</strong>
            <span>Select a driver and active deliveries, then optimize.</span>
          </div>
        )}
      </div>
    </section>
  );
}
