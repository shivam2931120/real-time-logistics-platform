import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Route, Truck } from "lucide-react";
import type { Driver, Order } from "@routepulse/shared";
import { LiveMap } from "../components/LiveMap";

export function DispatchPage({
  orders,
  drivers,
  geofenceRadiusMeters,
  assign,
}: {
  orders: Order[];
  drivers: Driver[];
  geofenceRadiusMeters?: number;
  assign: (orderId: string, driverId: string) => Promise<void>;
}) {
  const [orderId, setOrderId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = orders.filter((order) => order.status === "pending");
  const active = orders.filter((order) =>
    ["assigned", "picked_up", "in_transit"].includes(order.status),
  );
  const selected = pending.find((order) => order.id === orderId);
  const eligible = useMemo(
    () =>
      drivers.filter(
        (driver) =>
          driver.status === "available" &&
          (!selected || driver.capacityKg >= selected.packageWeightKg),
      ),
    [drivers, selected],
  );
  const canAssign = Boolean(
    selected && eligible.some((driver) => driver.id === driverId),
  );
  const submit = async () => {
    if (!canAssign || busy) return;
    setBusy(true);
    setError("");
    try {
      await assign(orderId, driverId);
      setOrderId("");
      setDriverId("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dispatch-page">
      <div className="dispatch-columns">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Unassigned queue</span>
              <h3>{pending.length} deliveries waiting</h3>
            </div>
            <Route />
          </div>
          <div className="dispatch-list">
            {pending.map((order) => (
              <button
                className={orderId === order.id ? "selected" : ""}
                key={order.id}
                onClick={() => {
                  setOrderId(order.id);
                  setDriverId("");
                }}
              >
                <span className={`priority ${order.priority}`}>
                  {order.priority[0].toUpperCase()}
                </span>
                <span>
                  <strong>{order.trackingCode}</strong>
                  <small>
                    {order.dropoff.label} · {order.packageWeightKg} kg
                  </small>
                </span>
                {order.lateRisk && <AlertTriangle />}
              </button>
            ))}
            {!pending.length && (
              <div className="compact-empty">
                <CheckCircle2 />
                <strong>Dispatch queue is clear</strong>
                <small>New unassigned deliveries will appear here.</small>
              </div>
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Eligible drivers</span>
              <h3>{eligible.length} ready to assign</h3>
            </div>
            <Truck />
          </div>
          <div className="dispatch-list">
            {eligible.map((driver) => (
              <button
                className={driverId === driver.id ? "selected" : ""}
                key={driver.id}
                onClick={() => setDriverId(driver.id)}
              >
                <span className="driver-avatar">{driver.name[0]}</span>
                <span>
                  <strong>{driver.name}</strong>
                  <small>
                    {driver.capacityKg} kg · {driver.status}
                  </small>
                </span>
                {driverId === driver.id && <CheckCircle2 />}
              </button>
            ))}
            {!eligible.length && (
              <div className="compact-empty">
                <Truck />
                <strong>No eligible drivers</strong>
                <small>
                  {selected
                    ? "Check availability and vehicle capacity."
                    : "Select a delivery to calculate eligibility."}
                </small>
              </div>
            )}
          </div>
          <div className="dispatch-action">
            {selected ? (
              <p>
                Assign <strong>{selected.trackingCode}</strong> to the selected
                driver.
              </p>
            ) : (
              <p>Select a delivery to see capacity-compatible drivers.</p>
            )}
            {error && <p className="error">{error}</p>}
            <button
              className="button primary full"
              disabled={!canAssign || busy}
              onClick={() => void submit()}
            >
              {busy ? "Assigning…" : "Confirm assignment"}
            </button>
          </div>
        </article>
      </div>
      <article className="panel dispatch-map">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Operations</span>
            <h3>{active.length} active deliveries</h3>
          </div>
          <span className="live-dot">
            <i />
            Live
          </span>
        </div>
        <LiveMap
          drivers={drivers}
          orders={[...pending, ...active]}
          selectedOrderId={orderId}
          selectedDriverId={driverId}
          geofenceRadiusMeters={geofenceRadiusMeters}
          onOrderSelect={(order) => {
            if (order.status === "pending") {
              setOrderId(order.id);
              setDriverId("");
            }
          }}
          onDriverSelect={(driver) =>
            eligible.some((item) => item.id === driver.id) &&
            setDriverId(driver.id)
          }
        />
      </article>
    </section>
  );
}
