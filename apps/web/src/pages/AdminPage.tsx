import { useEffect, useState } from "react";
import { Building2, Copy, KeyRound, MapPin, Plug, Save, ShieldCheck, UserCog, Webhook } from "lucide-react";
import type {
  AuditRecord,
  BillingSummary,
  IntegrationApiKeySummary,
  IntegrationWebhookSummary,
  OrganizationSettings,
  PaymentReconciliationSummary,
  PaymentSettlementSummary,
  Role,
  ServiceTerritory,
  User,
} from "@routepulse/shared";
import { api } from "../lib/api";

export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [tab, setTab] = useState<"team" | "settings" | "audit" | "integrations">("team");
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [reconciliation, setReconciliation] = useState<PaymentReconciliationSummary | null>(null);
  const [settlements, setSettlements] = useState<PaymentSettlementSummary | null>(null);
  const [territories, setTerritories] = useState<ServiceTerritory[]>([]);
  const [apiKeys, setApiKeys] = useState<IntegrationApiKeySummary[]>([]);
  const [webhooks, setWebhooks] = useState<IntegrationWebhookSummary[]>([]);
  const [keyName, setKeyName] = useState("Operations API");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [settlementCsv, setSettlementCsv] = useState("");
  const [territoryName, setTerritoryName] = useState("");
  const [territoryPolygon, setTerritoryPolygon] = useState("[{\"lat\":12.90,\"lng\":77.50},{\"lat\":13.05,\"lng\":77.50},{\"lat\":13.05,\"lng\":77.70},{\"lat\":12.90,\"lng\":77.70}]");
  const [revealedSecret, setRevealedSecret] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [team, records, configuration, billingSummary, paymentReconciliation, paymentSettlements, keys, hooks, territoryRows] = await Promise.all([
        api.adminUsers(),
        api.audit(),
        api.settings(),
        api.billingSummary(),
        api.paymentReconciliation(),
        api.paymentSettlements(),
        api.integrationApiKeys(),
        api.integrationWebhooks(),
        api.serviceTerritories(),
      ]);
      setUsers(team);
      setAudit(records);
      setSettings(configuration);
      setBilling(billingSummary);
      setReconciliation(paymentReconciliation);
      setSettlements(paymentSettlements);
      setApiKeys(keys);
      setWebhooks(hooks);
      setTerritories(territoryRows);
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
  const importSettlements = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !settlementCsv.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const summary = await api.importPaymentSettlements(settlementCsv);
      setSettlements(summary);
      setSettlementCsv("");
      setMessage(`Imported ${summary.rowCount} settlement rows. Review ${summary.reviewCount} flagged row${summary.reviewCount === 1 ? "" : "s"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to import settlement CSV");
    } finally {
      setBusy(false);
    }
  };
  const reviewSettlement = async (id: string, reviewStatus: "accepted" | "rejected") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.reviewPaymentSettlement(id, reviewStatus);
      setSettlements(await api.paymentSettlements());
      setMessage(`Settlement row ${reviewStatus}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to review settlement row");
    } finally {
      setBusy(false);
    }
  };
  const createTerritory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !territoryName.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const polygon = JSON.parse(territoryPolygon) as Array<{ lat: number; lng: number }>;
      const created = await api.createServiceTerritory({ name: territoryName.trim(), polygon, active: true });
      setTerritories((current) => [created, ...current]);
      setTerritoryName("");
      setMessage("Service territory created. New orders are checked against active territories.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enter a valid polygon JSON array");
    } finally { setBusy(false); }
  };
  const removeTerritory = async (id: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await api.deleteServiceTerritory(id); setTerritories((current) => current.filter((territory) => territory.id !== id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete territory"); }
    finally { setBusy(false); }
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
        <>
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
        <div className="panel settings-form territory-settings">
          <div className="panel-head"><div><span className="eyebrow">Service coverage</span><h3>Delivery territories</h3></div><MapPin /></div>
          <p className="muted-copy">Add a polygon as JSON coordinates. When at least one active territory exists, new drop-offs outside all polygons are rejected before dispatch.</p>
          <form onSubmit={createTerritory} className="form-grid">
            <label>Territory name<input value={territoryName} onChange={(event) => setTerritoryName(event.target.value)} placeholder="Bengaluru core" required /></label>
            <label className="span-2">Polygon JSON<textarea value={territoryPolygon} onChange={(event) => setTerritoryPolygon(event.target.value)} rows={3} /></label>
            <button className="button primary span-2" disabled={busy}><MapPin /> Add territory</button>
          </form>
          <div className="territory-list">
            {territories.map((territory) => <div className="integration-row" key={territory.id}><span><strong>{territory.name}</strong><small>{territory.polygon.length} points · {territory.active ? "active" : "inactive"}</small></span><button className="button ghost danger" onClick={() => void removeTerritory(territory.id)} disabled={busy}>Delete</button></div>)}
            {!territories.length && <small className="muted-copy">No territories configured; all validated coordinates are currently allowed.</small>}
          </div>
        </div>
        </>
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
            {reconciliation && (
              <div className="reconciliation-block">
                <div className="reconciliation-head">
                  <div>
                    <span className="eyebrow">Ledger integrity</span>
                    <h4>Payment reconciliation · last {reconciliation.windowDays} days</h4>
                  </div>
                  <span className={`reconciliation-status ${reconciliation.mismatchCount ? "has-mismatch" : "matched"}`}>
                    {reconciliation.mismatchCount ? `${reconciliation.mismatchCount} mismatch${reconciliation.mismatchCount === 1 ? "" : "es"}` : "Ledger matched"}
                  </span>
                </div>
                <div className="reconciliation-metrics">
                  <span><strong>{reconciliation.capturedCount}</strong><small>captured</small></span>
                  <span><strong>{reconciliation.outstandingCount}</strong><small>outstanding</small></span>
                  <span><strong>{reconciliation.failedCount}</strong><small>failed</small></span>
                  <span><strong>{reconciliation.missingRecordCount}</strong><small>missing provider records</small></span>
                </div>
                {(reconciliation.mismatchCount > 0 || reconciliation.missingRecordCount > 0) && (
                  <div className="reconciliation-rows">
                    {reconciliation.rows.filter((row) => row.status === "mismatch" || row.status === "missing_record").slice(0, 5).map((row) => (
                      <div className="reconciliation-row" key={row.orderId}>
                        <span><strong>{row.trackingCode}</strong><small>{row.customerName} · ₹{row.orderAmount.toLocaleString("en-IN")}</small></span>
                        <span className={`reconciliation-status ${row.status === "mismatch" ? "has-mismatch" : "missing"}`}>{row.status.replace("_", " ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="reconciliation-block settlement-review">
              <div className="reconciliation-head">
                <div>
                  <span className="eyebrow">Provider settlement review</span>
                  <h4>Import Razorpay settlement CSV</h4>
                </div>
                <span className={`reconciliation-status ${settlements?.reviewCount ? "has-mismatch" : "matched"}`}>
                  {settlements ? `${settlements.reviewCount} to review` : "No import yet"}
                </span>
              </div>
              <form onSubmit={importSettlements} className="settlement-import-form">
                <textarea
                  value={settlementCsv}
                  onChange={(event) => setSettlementCsv(event.target.value)}
                  placeholder="payment_id,order_id,amount,currency,status,fee,settled_at\n..."
                  aria-label="Settlement CSV"
                  rows={3}
                />
                <button className="button primary" disabled={busy || !settlementCsv.trim()}>
                  {busy ? "Importing…" : "Import settlement"}
                </button>
              </form>
              {settlements && (
                <>
                  <div className="reconciliation-metrics">
                    <span><strong>{settlements.rowCount}</strong><small>rows</small></span>
                    <span><strong>{settlements.matchedCount}</strong><small>matched</small></span>
                    <span><strong>{settlements.missingOrderCount}</strong><small>missing orders</small></span>
                    <span><strong>{settlements.refundCount}</strong><small>refund/chargeback</small></span>
                  </div>
                  <div className="reconciliation-rows">
                    {settlements.rows.filter((row) => row.reviewStatus === "pending").slice(0, 8).map((row) => (
                      <div className="reconciliation-row" key={row.id}>
                        <span>
                          <strong>{row.providerRef}</strong>
                          <small>{row.trackingCode || "No matched order"} · {row.matchStatus.replace("_", " ")} · {row.currency} {row.providerAmount.toFixed(2)}</small>
                        </span>
                        <span className="settlement-actions">
                          <button className="button ghost" onClick={() => void reviewSettlement(row.id, "accepted")} disabled={busy}>Accept</button>
                          <button className="button ghost danger" onClick={() => void reviewSettlement(row.id, "rejected")} disabled={busy}>Reject</button>
                        </span>
                      </div>
                    ))}
                    {!settlements.reviewCount && <small className="muted-copy">No flagged settlement rows.</small>}
                  </div>
                </>
              )}
            </div>
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
