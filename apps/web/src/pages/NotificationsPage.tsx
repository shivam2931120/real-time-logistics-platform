import { useEffect, useState } from "react";
import { Bell, CheckCheck, Mail, RefreshCw } from "lucide-react";
import type { NotificationRecord } from "@routepulse/shared";
import { api } from "../lib/api";

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await api.notifications());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load notifications",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const read = async (item: NotificationRecord) => {
    if (item.readAt || reading) return;
    setReading(item.id);
    try {
      await api.readNotification(item.id);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to mark notification as read",
      );
    } finally {
      setReading("");
    }
  };
  return (
    <section className="panel notifications-page">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Communication history</span>
          <h3>{items.filter((item) => !item.readAt).length} unread updates</h3>
        </div>
        <Bell />
      </div>
      {error && (
        <div className="inline-retry" role="alert">
          <span>{error}</span>
          <button onClick={() => void load()}>
            <RefreshCw /> Retry
          </button>
        </div>
      )}
      <div className="notification-list">
        {loading && !items.length && (
          <div className="list-skeleton" aria-label="Loading notifications">
            <i />
            <i />
            <i />
          </div>
        )}
        {items.map((item) => (
          <button
            className={item.readAt ? "read" : ""}
            key={item.id}
            disabled={Boolean(reading)}
            onClick={() => void read(item)}
          >
            <span>{item.channel === "email" ? <Mail /> : <Bell />}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              <small>
                {new Date(item.createdAt).toLocaleString()} · {item.status}
              </small>
            </div>
            {item.readAt ? <CheckCheck /> : <i />}
          </button>
        ))}
        {!loading && !items.length && !error && (
          <div className="empty-state">
            <Bell />
            <strong>No notifications yet</strong>
            <span>Delivery and payment updates will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}
