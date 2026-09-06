import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Route, Sparkles, Truck } from "lucide-react";
import type { Driver, Order } from "@routepulse/shared";
import { api, type RoutePlan } from "../lib/api";
import { LiveMap } from "../components/LiveMap";

export function RoutePlannerPage({
  drivers,
  orders,
}: {
  drivers: Driver[];
  orders: Order[];
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!driverId && drivers[0]) setDriverId(drivers[0].id);
  }, [driverId, drivers]);
  useEffect(() => {
    setSelected((current) =>
      current.length
        ? current.filter((id) => candidates.some((order) => order.id === id))
        : candidates.slice(0, 6).map((order) => order.id),
    );
  }, [candidates]);
  const driver = drivers.find((item) => item.id === driverId);
  const selectedOrders = candidates.filter((order) =>
    selected.includes(order.id),
  );
  const demand = selectedOrders.reduce(
    (total, order) => total + order.packageWeightKg,
    0,
  );
  const optimize = async () => {
    if (!driverId || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      setPlan(await api.optimize(driverId, selected));
    } catch (reason) {
      setPlan(null);
      setError(
        reason instanceof Error ? reason.message : "Unable to optimize route",
      );
    } finally {
      setBusy(false);
    }
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
              {demand.toFixed(1)} / {driver?.capacityKg || 0} kg
            </strong>
          </div>
          <progress max={driver?.capacityKg || 1} value={demand} />
        </div>
        <div className="stop-picker">
          <div className="stop-picker-head">
            <strong>Delivery stops</strong>
            <button
              type="button"
              onClick={() =>
                setSelected(
                  selected.length === candidates.length
                    ? []
                    : candidates.map((order) => order.id),
                )
              }
            >
              {selected.length === candidates.length
                ? "Clear all"
                : "Select all"}
            </button>
          </div>
          {candidates.map((order) => (
            <label
              key={order.id}
              className={selected.includes(order.id) ? "selected" : ""}
            >
              <input
                type="checkbox"
                checked={selected.includes(order.id)}
                onChange={() => {
                  setSelected((items) =>
                    items.includes(order.id)
                      ? items.filter((id) => id !== order.id)
                      : [...items, order.id],
                  );
                  setPlan(null);
                }}
              />
              <span>
                <strong>{order.trackingCode}</strong>
                <small>
                  {order.dropoff.label} · {order.packageWeightKg} kg
                </small>
              </span>
              <b>{order.priority}</b>
            </label>
          ))}
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
          disabled={busy || !driverId || !selected.length}
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
          routeCoordinates={
            plan && driver ? [driver.location, ...plan.stops] : undefined
          }
        />
        {plan ? (
          <div className="route-result">
            <div>
              <Route />
              <span>
                <strong>{plan.distanceKm} km</strong>
                <small>Optimized distance</small>
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
                <strong>
                  {Math.round((demand / (driver?.capacityKg || 1)) * 100)}%
                </strong>
                <small>Vehicle utilization</small>
              </span>
            </div>
            <ol>
              {plan.stops.map((stop, index) => (
                <li key={stop.id}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{stop.label}</strong>
                    <small>{stop.demandKg || 0} kg delivery</small>
                  </div>
                  <CheckCircle2 />
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
