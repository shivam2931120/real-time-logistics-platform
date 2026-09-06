import { useEffect, useState } from "react";
import { Building2, Save, ShieldCheck, UserCog } from "lucide-react";
import type {
  AuditRecord,
  OrganizationSettings,
  Role,
  User,
} from "@routepulse/shared";
import { api } from "../lib/api";

export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [tab, setTab] = useState<"team" | "settings" | "audit">("team");
  const [message, setMessage] = useState("");
  const load = async () => {
    const [team, records, configuration] = await Promise.all([
      api.adminUsers(),
      api.audit(),
      api.settings(),
    ]);
    setUsers(team);
    setAudit(records);
    setSettings(configuration);
  };
  useEffect(() => {
    void load();
  }, []);
  const role = async (user: User, value: Role) => {
    await api.updateRole(user.id, value);
    await load();
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) return;
    await api.updateSettings(settings);
    setMessage("Settings saved");
    await load();
  };
  return (
    <section className="admin-page">
      <div className="admin-tabs">
        {(["team", "settings", "audit"] as const).map((value) => (
          <button
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
            key={value}
          >
            {value}
          </button>
        ))}
      </div>
      {tab === "team" && (
        <div className="panel admin-team">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Access management</span>
              <h3>{users.length} workspace members</h3>
            </div>
            <UserCog />
          </div>
          {users.map((user) => (
            <div className="team-row" key={user.id}>
              <span className="avatar">
                {user.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              <div>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </div>
              <select
                aria-label={`Role for ${user.name}`}
                value={user.role}
                onChange={(event) =>
                  void role(user, event.target.value as Role)
                }
              >
                <option value="admin">Admin</option>
                <option value="dispatcher">Dispatcher</option>
                <option value="driver">Driver</option>
                <option value="customer">Customer</option>
              </select>
            </div>
          ))}
        </div>
      )}
      {tab === "settings" && settings && (
        <form className="panel settings-form" onSubmit={save}>
          <div className="panel-head">
            <div>
              <span className="eyebrow">Organization defaults</span>
              <h3>Operational settings</h3>
            </div>
            <Building2 />
          </div>
          <label>
            Organization name
            <input
              value={settings.name}
              onChange={(event) =>
                setSettings({ ...settings, name: event.target.value })
              }
            />
          </label>
          <label>
            Timezone
            <input
              value={settings.timezone}
              onChange={(event) =>
                setSettings({ ...settings, timezone: event.target.value })
              }
            />
          </label>
          <label>
            Geofence radius (metres)
            <input
              type="number"
              min="50"
              max="1000"
              value={settings.geofenceRadiusMeters}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  geofenceRadiusMeters: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Average urban speed (km/h)
            <input
              type="number"
              min="5"
              max="120"
              value={settings.averageSpeedKph}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  averageSpeedKph: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.notificationsEnabled}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  notificationsEnabled: event.target.checked,
                })
              }
            />
            Email and in-app notifications
          </label>
          {message && <p className="success-note">{message}</p>}
          <button className="button primary">
            <Save />
            Save settings
          </button>
        </form>
      )}
      {tab === "audit" && (
        <div className="panel audit-list">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Accountability</span>
              <h3>Audit trail</h3>
            </div>
            <ShieldCheck />
          </div>
          {audit.map((item) => (
            <div key={item.id}>
              <span className="audit-action">{item.action}</span>
              <strong>
                {item.resourceType} · {item.resourceId}
              </strong>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
            </div>
          ))}
          {!audit.length && (
            <div className="empty-state">
              <ShieldCheck />
              <strong>No audit events yet</strong>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
