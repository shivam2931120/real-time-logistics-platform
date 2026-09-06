import { useMemo, useState } from "react";
import { ChevronRight, Map, Plus, Search } from "lucide-react";
import type { Driver, Order, OrderStatus } from "@routepulse/shared";
import { LiveMap } from "../components/LiveMap";

const filters: Array<"all" | OrderStatus> = [
  "all",
  "pending",
  "assigned",
  "picked_up",
  "in_transit",
  "delivered",
];
const statusLabel = (value: string) => value.replace("_", " ");

export function DeliveriesPage({
  orders,
  drivers,
  create,
  select,
  assign,
}: {
  orders: Order[];
  drivers: Driver[];
  create: () => void;
  select: (order: Order) => void;
  assign: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [mapOpen, setMapOpen] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const filtered = useMemo(
    () =>
      orders.filter(
        (order) =>
          (status === "all" || order.status === status) &&
          `${order.trackingCode} ${order.customerName} ${order.dropoff.label}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [orders, query, status],
  );
  const choose = (order: Order) => {
    setSelectedId(order.id);
    select(order);
  };

  return (
    <section className="deliveries-page">
      <div className="page-toolbar">
        <label>
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tracking, customer, destination"
          />
        </label>
        <div className="toolbar-actions">
          <button
            className={`button ghost${mapOpen ? " active" : ""}`}
            onClick={() => setMapOpen((value) => !value)}
          >
            <Map />
            Map
          </button>
          <button className="button primary" onClick={create}>
            <Plus />
            New delivery
          </button>
        </div>
      </div>
      <div className="filter-chips">
        {filters.map((value) => (
          <button
            type="button"
            className={status === value ? "active" : ""}
            key={value}
            onClick={() => setStatus(value)}
          >
            {statusLabel(value)}
            {value !== "all" && (
              <b>{orders.filter((order) => order.status === value).length}</b>
            )}
          </button>
        ))}
      </div>
      {mapOpen && (
        <div className="panel deliveries-map">
          <LiveMap
            drivers={drivers}
            orders={filtered}
            selectedOrderId={selectedId}
            onOrderSelect={(order) => setSelectedId(order.id)}
          />
        </div>
      )}
      <div className="panel table-panel">
        <div className="table-summary">
          <strong>{filtered.length} deliveries</strong>
          <span>Live status and payment overview</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Delivery</th>
                <th>Customer</th>
                <th>Destination</th>
                <th>Service</th>
                <th>Status</th>
                <th>ETA / Window</th>
                <th>Payment</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr
                  className={selectedId === order.id ? "selected-row" : ""}
                  key={order.id}
                >
                  <td>
                    <strong>{order.trackingCode}</strong>
                    <small>
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </td>
                  <td>{order.customerName}</td>
                  <td>{order.dropoff.label}</td>
                  <td>
                    <span className={`service ${order.priority}`}>
                      {order.priority}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${order.status}`}>
                      <i />
                      {statusLabel(order.status)}
                    </span>
                  </td>
                  <td>
                    <strong className={order.lateRisk ? "late-text" : ""}>
                      {order.estimatedArrivalAt
                        ? new Date(order.estimatedArrivalAt).toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )
                        : "Awaiting route"}
                    </strong>
                    <small>
                      {order.deliveryWindowStart
                        ? `${new Date(order.deliveryWindowStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${new Date(order.promisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        : `Due ${new Date(order.promisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                    </small>
                  </td>
                  <td>
                    <span className={`status ${order.paymentStatus}`}>
                      <i />
                      {order.paymentStatus}
                    </span>
                  </td>
                  <td>
                    <button
                      className="text-btn"
                      onClick={() =>
                        order.status === "pending"
                          ? void assign(order.id)
                          : choose(order)
                      }
                    >
                      {order.status === "pending" ? "Auto assign" : "Details"}
                      <ChevronRight />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="empty-state">
              <Search />
              <strong>No matching deliveries</strong>
              <span>Adjust the search or status filter.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
