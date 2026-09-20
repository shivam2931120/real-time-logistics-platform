import { useEffect, useState } from "react";
import { Building2, Copy, KeyRound, Plug, Save, ShieldCheck, UserCog, Webhook } from "lucide-react";
import type {
  AuditRecord,
  BillingSummary,
  IntegrationApiKeySummary,
  IntegrationWebhookSummary,
  OrganizationSettings,
  Role,
  User,
} from "@routepulse/shared";
import { api } from "../lib/api";

export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [tab, setTab] = useState<"team" | "settings" | "audit" | "integrations">("team");
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [apiKeys, setApiKeys] = useState<IntegrationApiKeySummary[]>([]);
  const [webhooks, setWebhooks] = useState<IntegrationWebhookSummary[]>([]);
  const [keyName, setKeyName] = useState("Operations API");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [revealedSecret, setRevealedSecret] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [team, records, configuration, billingSummary, keys, hooks] = await Promise.all([
        api.adminUsers(),
        api.audit(),
        api.settings(),
        api.billingSummary(),
        api.integrationApiKeys(),
        api.integrationWebhooks(),
      ]);
      setUsers(team);
      setAudit(records);
      setSettings(configuration);
      setBilling(billingSummary);
      setApiKeys(keys);
      setWebhooks(hooks);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load administration",
      );
    } finally {
      setLoading(false);
    }
  };
  const createKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !keyName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.createIntegrationApiKey(keyName.trim());
      setRevealedSecret(created.key);
      setMessage("API key created. Copy it now; it will not be shown again.");
      setKeyName("Operations API");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create API key");
    } finally {
      setBusy(false);
    }
  };
  const createWebhook = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !webhookUrl.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.createIntegrationWebhook(webhookUrl.trim(), ["*"]);
      setRevealedSecret(created.secret);
      setMessage("Webhook created. Store the signing secret securely.");
      setWebhookUrl("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create webhook");
    } finally {
      setBusy(false);
    }
  };
  const revokeKey = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.revokeIntegrationApiKey(id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to revoke API key");
    } finally {
      setBusy(false);
    }
  };
  const disableWebhook = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.disableIntegrationWebhook(id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to disable webhook");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const role = async (user: User, value: Role) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.updateRole(user.id, value);
      setMessage(`Role updated for ${user.name}`);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to update role",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.updateSettings(settings);
      setMessage("Settings saved");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save settings",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-page">
      {error && (
        <div className="inline-retry" role="alert">
          <span>{error}</span>
          <button onClick={() => void load()} disabled={loading || busy}>
            Retry
          </button>
        </div>
      )}
      {loading && <p role="status">Loading administration…</p>}
      {message && (
        <p className="saved-message" role="status">
          {message}
        </p>
      )}
      <div className="admin-tabs">
        {(["team", "settings", "integrations", "audit"] as const).map((value) => (
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
                disabled={busy || loading}
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
          <button className="button primary" disabled={busy || loading}>
            <Save />
            {busy ? "Saving…" : "Save settings"}
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
          {!loading && !error && !audit.length && (
            <div className="empty-state">
              <ShieldCheck />
              <strong>No audit events yet</strong>
            </div>
          )}
        </div>
      )}
      {tab === "integrations" && (
        <div className="admin-integrations">
          <div className="panel billing-summary">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Billing operations</span>
                <h3>Current month</h3>
              </div>
              <Plug />
            </div>
            {billing && (
              <div className="billing-metrics">
                <span><strong>{billing.orderCount}</strong><small>orders</small></span>
                <span><strong>₹{billing.capturedPayments.toLocaleString("en-IN")}</strong><small>captured</small></span>
                <span><strong>₹{billing.outstandingAmount.toLocaleString("en-IN")}</strong><small>outstanding</small></span>
                <span><strong>{billing.paymentCollectionRate}%</strong><small>collection rate</small></span>
              </div>
            )}
          </div>
          <div className="panel integration-card">
            <div className="panel-head"><div><span className="eyebrow">Server-to-server</span><h3>Integration API keys</h3></div><KeyRound /></div>
            <form className="inline-form" onSubmit={createKey}>
              <input value={keyName} onChange={(event) => setKeyName(event.target.value)} aria-label="API key name" />
              <button className="button primary" disabled={busy}>Create key</button>
            </form>
            {revealedSecret && <div className="secret-reveal"><code>{revealedSecret}</code><button className="button ghost" onClick={() => void navigator.clipboard?.writeText(revealedSecret)}><Copy /> Copy</button></div>}
            {apiKeys.map((key) => <div className="integration-row" key={key.id}><span><strong>{key.name}</strong><small>{key.prefix} · {key.revokedAt ? "revoked" : key.lastUsedAt ? `used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "never used"}</small></span>{!key.revokedAt && <button className="button ghost" onClick={() => void revokeKey(key.id)} disabled={busy}>Revoke</button>}</div>)}
          </div>
          <div className="panel integration-card">
            <div className="panel-head"><div><span className="eyebrow">Outbound events</span><h3>Webhooks</h3></div><Webhook /></div>
            <form className="inline-form" onSubmit={createWebhook}>
              <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/routepulse" aria-label="Webhook URL" />
              <button className="button primary" disabled={busy}>Add webhook</button>
            </form>
            {webhooks.map((hook) => <div className="integration-row" key={hook.id}><span><strong>{hook.url}</strong><small>{hook.events.join(", ")} · {hook.active ? "active" : "disabled"}</small></span>{hook.active && <button className="button ghost" onClick={() => void disableWebhook(hook.id)} disabled={busy}>Disable</button>}</div>)}
          </div>
        </div>
      )}
    </section>
  );
}
