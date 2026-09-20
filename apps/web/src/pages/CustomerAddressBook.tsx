import { useEffect, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import type { CustomerAddressBookEntry } from "@routepulse/shared";
import { api } from "../lib/api";

export function CustomerAddressBook({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<CustomerAddressBookEntry[]>([]);
  const [label, setLabel] = useState("");
  const [addressLabel, setAddressLabel] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [notes, setNotes] = useState("");
  const [contactName, setContactName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setEntries(await api.customerAddresses());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load saved addresses");
    }
  };
  useEffect(() => { void load(); }, []);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.createCustomerAddress({
        label: label.trim(),
        address: { label: addressLabel.trim(), lat: Number(lat), lng: Number(lng) },
        deliveryNotes: notes.trim() || undefined,
        contactName: contactName.trim() || undefined,
      });
      setLabel(""); setAddressLabel(""); setLat(""); setLng(""); setNotes(""); setContactName("");
      setMessage("Address saved");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save address");
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await api.deleteCustomerAddress(id); setEntries((current) => current.filter((entry) => entry.id !== id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove address"); }
    finally { setBusy(false); }
  };
  return (
    <section className="customer-address-book">
      <div className="driver-greeting">
        <button className="button ghost" onClick={onBack}>Back to deliveries</button>
        <span className="eyebrow">Customer preferences</span>
        <h1>Saved addresses</h1>
        <p>Reuse verified coordinates and delivery notes at checkout.</p>
      </div>
      {error && <p className="inline-notice warning" role="alert">{error}</p>}
      {message && <p className="inline-notice success" role="status">{message}</p>}
      <form className="panel form-grid address-book-form" onSubmit={create}>
        <label>Shortcut label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Home" required /></label>
        <label>Address label<input value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} placeholder="12 MG Road" required /></label>
        <label>Latitude<input value={lat} onChange={(event) => setLat(event.target.value)} type="number" min="-90" max="90" step="any" required /></label>
        <label>Longitude<input value={lng} onChange={(event) => setLng(event.target.value)} type="number" min="-180" max="180" step="any" required /></label>
        <label>Contact name<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Optional" /></label>
        <label>Delivery notes<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Gate, landmark, preferred time" /></label>
        <button className="button primary span-2" disabled={busy}><Plus /> {busy ? "Saving…" : "Save address"}</button>
      </form>
      <section className="panel address-book-list">
        {entries.map((entry) => (
          <div className="address-book-row" key={entry.id}>
            <MapPin />
            <span><strong>{entry.label}</strong><small>{entry.address.label} · {entry.address.lat.toFixed(5)}, {entry.address.lng.toFixed(5)}</small>{entry.deliveryNotes && <small>{entry.deliveryNotes}</small>}</span>
            <button className="button ghost danger" onClick={() => void remove(entry.id)} disabled={busy} aria-label={`Delete ${entry.label}`}><Trash2 /></button>
          </div>
        ))}
        {!entries.length && <div className="empty-state"><MapPin /><strong>No saved addresses yet</strong></div>}
      </section>
    </section>
  );
}
