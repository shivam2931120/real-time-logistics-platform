import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import type { DeliveryException, Order } from "@routepulse/shared";
import { api } from "../lib/api";

export function ExceptionsPage({ orders }: { orders: Order[] }) {
  const [items, setItems] = useState<DeliveryException[]>([]);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await api.exceptions());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load exceptions",
      );
    } finally {
      setLoading(false);
    }
  };
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
    if (!resolution?.trim() || resolving) return;
    setResolving(item.id);
    try {
      await api.resolveException(item.id, resolution.trim());
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to resolve exception",
      );
    } finally {
      setResolving("");
    }
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
      {error && (
        <div className="inline-retry" role="alert">
          <span>{error}</span>
          <button onClick={() => void load()}>
            <RefreshCw /> Retry
          </button>
        </div>
      )}
      <div className="exception-list">
        {loading && !items.length && (
          <div className="panel list-skeleton" aria-label="Loading exceptions">
            <i />
            <i />
            <i />
          </div>
        )}
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
                  disabled={Boolean(resolving)}
                  onClick={() => void resolve(item)}
                >
                  {resolving === item.id ? "Resolving…" : "Resolve"}
                </button>
              )}
            </article>
          );
        })}
        {!loading && !visible.length && !error && (
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
