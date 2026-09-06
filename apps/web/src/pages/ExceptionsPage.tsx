import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import type { DeliveryException, Order } from "@routepulse/shared";
import { api } from "../lib/api";

export function ExceptionsPage({ orders }: { orders: Order[] }) {
  const [items, setItems] = useState<DeliveryException[]>([]);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [error, setError] = useState("");
  const load = () =>
    api
      .exceptions()
      .then(setItems)
      .catch((reason) => setError((reason as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const visible = useMemo(
    () =>
      filter === "all" ? items : items.filter((item) => item.status === filter),
    [filter, items],
  );
  const resolve = async (item: DeliveryException) => {
    const resolution = window.prompt("How was this exception resolved?");
    if (!resolution) return;
    await api.resolveException(item.id, resolution);
    await load();
  };
  return (
    <section className="exceptions-page">
      <div className="exception-stats">
        <article className="panel">
          <AlertTriangle />
          <span>
            <strong>
              {items.filter((item) => item.status === "open").length}
            </strong>
            <small>Open exceptions</small>
          </span>
        </article>
        <article className="panel">
          <CheckCircle2 />
          <span>
            <strong>
              {items.filter((item) => item.status === "resolved").length}
            </strong>
            <small>Resolved</small>
          </span>
        </article>
        <article className="panel">
          <Clock3 />
          <span>
            <strong>{orders.filter((order) => order.lateRisk).length}</strong>
            <small>At risk</small>
          </span>
        </article>
      </div>
      <div className="filter-chips">
        {(["open", "resolved", "all"] as const).map((value) => (
          <button
            className={filter === value ? "active" : ""}
            key={value}
            onClick={() => setFilter(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="exception-list">
        {visible.map((item) => {
          const order = orders.find((value) => value.id === item.orderId);
          return (
            <article className="panel" key={item.id}>
              <span className={`exception-icon ${item.status}`}>
                <AlertTriangle />
              </span>
              <div>
                <span className="eyebrow">
                  {item.type.replaceAll("_", " ")}
                </span>
                <h3>{order?.trackingCode || item.orderId}</h3>
                <p>{item.description}</p>
                <small>
                  Raised {new Date(item.createdAt).toLocaleString()}
                </small>
                {item.resolution && (
                  <div className="resolution">
                    <CheckCircle2 />
                    {item.resolution}
                  </div>
                )}
              </div>
              {item.status === "open" && (
                <button
                  className="button ghost"
                  onClick={() => void resolve(item)}
                >
                  Resolve
                </button>
              )}
            </article>
          );
        })}
        {!visible.length && (
          <div className="panel empty-state">
            <CheckCircle2 />
            <strong>No {filter === "all" ? "" : filter} exceptions</strong>
            <span>Operational issues will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}
