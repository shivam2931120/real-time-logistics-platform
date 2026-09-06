import { useMemo, useState } from "react";
import { LocateFixed, Radio, Truck } from "lucide-react";
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
}: {
  drivers: Driver[];
  orders: Order[];
  reload: () => void;
}) {
  const [filter, setFilter] = useState<"all" | DriverStatus>("all");
  const [selectedId, setSelectedId] = useState(drivers[0]?.id ?? "");
  const visible = useMemo(
    () =>
      filter === "all"
        ? drivers
        : drivers.filter((driver) => driver.status === filter),
    [drivers, filter],
  );
  const selected = drivers.find((driver) => driver.id === selectedId);

  const update = async (data: {
    status?: DriverStatus;
    capacityKg?: number;
  }) => {
    if (!selected) return;
    await api.updateDriver(selected.id, data);
    reload();
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
            WebSocket live
          </span>
        </div>
        <LiveMap
          drivers={visible}
          orders={orders}
          selectedDriverId={selectedId}
          onDriverSelect={(driver) => setSelectedId(driver.id)}
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
              {selected.status === "offline"
                ? "Last known location"
                : "Receiving live location updates"}
            </small>
            <div className="driver-edit">
              <select
                value={selected.status}
                onChange={(event) =>
                  void update({ status: event.target.value as DriverStatus })
                }
              >
                <option value="available">Available</option>
                <option value="busy">Busy</option>
                <option value="offline">Offline</option>
              </select>
              <label>
                Capacity
                <input
                  type="number"
                  min="1"
                  defaultValue={selected.capacityKg}
                  onBlur={(event) =>
                    void update({ capacityKg: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
