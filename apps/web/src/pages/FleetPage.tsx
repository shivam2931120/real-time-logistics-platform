import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LocateFixed, Radio, Save, Truck } from "lucide-react";
import type { Driver, DriverStatus, Order } from "@routepulse/shared";
import { LiveMap } from "../components/LiveMap";
import { api } from "../lib/api";

const statuses: Array<"all" | DriverStatus> = [
  "all",
  "available",
  "busy",
  "offline",
];

export function FleetPage({
  drivers,
  orders,
  reload,
  geofenceRadiusMeters,
}: {
  drivers: Driver[];
  orders: Order[];
  reload: () => void;
  geofenceRadiusMeters?: number;
}) {
  const [filter, setFilter] = useState<"all" | DriverStatus>("all");
  const [selectedId, setSelectedId] = useState(drivers[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const visible = useMemo(
    () =>
      filter === "all"
        ? drivers
        : drivers.filter((driver) => driver.status === filter),
    [drivers, filter],
  );
  const selected = visible.find((driver) => driver.id === selectedId);
  useEffect(() => {
    if (visible.length && !visible.some((driver) => driver.id === selectedId))
      setSelectedId(visible[0].id);
  }, [selectedId, visible]);
  useEffect(() => {
    setError("");
    setSaved(false);
  }, [selectedId]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setSaved(false);
    setError("");
    const form = new FormData(event.currentTarget);
    const maintenanceDate = String(form.get("maintenanceDueAt") || "");
    try {
      await api.updateDriver(selected.id, {
        status: String(form.get("status")) as DriverStatus,
        capacityKg: Number(form.get("capacityKg")),
        vehiclePlate: String(form.get("vehiclePlate") || "").trim(),
        shiftStart: String(form.get("shiftStart")),
        shiftEnd: String(form.get("shiftEnd")),
        maintenanceDueAt: maintenanceDate
          ? new Date(`${maintenanceDate}T00:00:00`).toISOString()
          : null,
        maintenanceStatus: String(form.get("maintenanceStatus")) as
          "ok" | "due" | "overdue",
      });
      await reload();
      setSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save driver",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="fleet-layout">
      <div className="panel fleet-map-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Live positioning</span>
            <h3>Fleet command map</h3>
          </div>
          <span className="live-dot">
            <i />
            Fleet positions
          </span>
        </div>
        <LiveMap
          drivers={visible}
          orders={orders}
          selectedDriverId={selectedId}
          geofenceRadiusMeters={geofenceRadiusMeters}
          onDriverSelect={(driver) => {
            if (!saving) setSelectedId(driver.id);
          }}
        />
      </div>
      <div className="panel fleet-roster">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Drivers</span>
            <h3>{visible.length} vehicles shown</h3>
          </div>
          <Truck />
        </div>
        <div className="filter-chips">
          {statuses.map((status) => (
            <button
              type="button"
              className={filter === status ? "active" : ""}
              key={status}
              disabled={saving}
              aria-pressed={filter === status}
              onClick={() => setFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="driver-roster">
          {visible.map((driver) => (
            <button
              type="button"
              key={driver.id}
              disabled={saving}
              className={selectedId === driver.id ? "selected" : ""}
              onClick={() => setSelectedId(driver.id)}
            >
              <span className="driver-avatar">{driver.name[0]}</span>
              <span>
                <strong>{driver.name}</strong>
                <small>
                  <Radio />
                  {driver.status} ·{" "}
                  {new Date(driver.lastSeenAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <b>{driver.capacityKg} kg</b>
            </button>
          ))}
          {!visible.length && (
            <div className="compact-empty">
              <Truck />
              <strong>No drivers match this filter</strong>
              <small>Try another availability status.</small>
            </div>
          )}
        </div>
        {selected && (
          <div className="driver-detail">
            <span className="eyebrow">Selected vehicle</span>
            <strong>{selected.name}</strong>
            <p>
              <LocateFixed />
              {selected.location.lat.toFixed(5)},{" "}
              {selected.location.lng.toFixed(5)}
            </p>
            <small>
              Last location update:{" "}
              {new Date(selected.lastSeenAt).toLocaleString()}
            </small>
            <form className="driver-edit" key={selected.id} onSubmit={save}>
              <label>
                Availability
                <select name="status" defaultValue={selected.status}>
                  <option value="available">Available</option>
                  <option value="busy">Busy</option>
                  <option value="offline">Offline</option>
                </select>
              </label>
              <label>
                Capacity
                <input
                  name="capacityKg"
                  type="number"
                  min="1"
                  max="5000"
                  required
                  defaultValue={selected.capacityKg}
                />
              </label>
              <label>
                Vehicle plate
                <input
                  name="vehiclePlate"
                  maxLength={32}
                  defaultValue={selected.vehiclePlate || ""}
                  placeholder="KA-01-RP-101"
                />
              </label>
              <label>
                Shift start
                <input
                  name="shiftStart"
                  required
                  type="time"
                  defaultValue={selected.shiftStart || "08:00"}
                />
              </label>
              <label>
                Shift end
                <input
                  name="shiftEnd"
                  required
                  type="time"
                  defaultValue={selected.shiftEnd || "18:00"}
                />
              </label>
              <label>
                Maintenance
                <select
                  name="maintenanceStatus"
                  defaultValue={selected.maintenanceStatus || "ok"}
                >
                  <option value="ok">Operational</option>
                  <option value="due">Due soon</option>
                  <option value="overdue">Overdue</option>
                </select>
              </label>
              <label>
                Maintenance date
                <input
                  name="maintenanceDueAt"
                  type="date"
                  defaultValue={selected.maintenanceDueAt?.slice(0, 10) || ""}
                />
              </label>
              {error && (
                <p className="error driver-form-message" role="alert">
                  {error}
                </p>
              )}
              {saved && (
                <p className="driver-form-message saved-message" role="status">
                  <CheckCircle2 /> Driver profile saved
                </p>
              )}
              <button className="button primary full" disabled={saving}>
                <Save /> {saving ? "Saving…" : "Save driver changes"}
              </button>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
