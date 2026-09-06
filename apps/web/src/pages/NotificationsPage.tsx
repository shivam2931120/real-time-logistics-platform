import { useEffect, useState } from "react";
import { Bell, CheckCheck, Mail } from "lucide-react";
import type { NotificationRecord } from "@routepulse/shared";
import { api } from "../lib/api";

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    api
      .notifications()
      .then(setItems)
      .catch((reason) => setError((reason as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const read = async (item: NotificationRecord) => {
    if (item.readAt) return;
    await api.readNotification(item.id);
    await load();
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
      {error && <p className="error">{error}</p>}
      <div className="notification-list">
        {items.map((item) => (
          <button
            className={item.readAt ? "read" : ""}
            key={item.id}
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
        {!items.length && (
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
