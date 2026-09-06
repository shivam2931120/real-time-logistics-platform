import { useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
export function CreateOrder({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const start = String(f.get("windowStart") || "");
    try {
      await api.create({
        customerName: f.get("name"),
        customerEmail: f.get("email"),
        pickup: { label: "Indiranagar Hub", lat: 12.9784, lng: 77.6408 },
        dropoff: {
          label: f.get("destination"),
          lat: Number(f.get("lat")),
          lng: Number(f.get("lng")),
        },
        packageWeightKg: Number(f.get("weight")),
        priority: f.get("priority"),
        amount: Number(f.get("amount")),
        currency: "INR",
        deliveryWindowStart: start ? new Date(start).toISOString() : undefined,
        deliveryNotes: f.get("notes") || undefined,
        recipientPin: f.get("pin"),
        promisedAt: new Date(
          Date.now() + Number(f.get("hours")) * 3600000,
        ).toISOString(),
      });
      saved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">New shipment</span>
            <h2 id="create-title">Create delivery</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X />
          </button>
        </div>
        <form onSubmit={submit} className="form-grid">
          <label>
            Customer name
            <input
              name="name"
              required
              minLength={2}
              placeholder="Ananya Rao"
            />
          </label>
          <label>
            Email
            <input
              name="email"
              required
              type="email"
              placeholder="ananya@example.com"
            />
          </label>
          <label className="span-2">
            Destination
            <input
              name="destination"
              required
              placeholder="HSR Layout, Bengaluru"
            />
          </label>
          <label>
            Latitude
            <input
              name="lat"
              required
              type="number"
              step="any"
              defaultValue="12.9121"
            />
          </label>
          <label>
            Longitude
            <input
              name="lng"
              required
              type="number"
              step="any"
              defaultValue="77.6446"
            />
          </label>
          <label>
            Weight (kg)
            <input
              name="weight"
              required
              type="number"
              min="0.1"
              step="0.1"
              defaultValue="2"
            />
          </label>
          <label>
            Service
            <select name="priority">
              <option value="standard">Standard</option>
              <option value="express">Express</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label>
            Price (₹)
            <input
              name="amount"
              required
              type="number"
              min="0"
              defaultValue="299"
            />
          </label>
          <label>
            Delivery PIN
            <input
              name="pin"
              required
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              defaultValue="1234"
            />
          </label>
          <label>
            Window starts
            <input name="windowStart" type="datetime-local" />
          </label>
          <label>
            Promise in (hours)
            <input
              name="hours"
              required
              type="number"
              min="1"
              defaultValue="3"
            />
          </label>
          <label className="span-2">
            Driver notes
            <textarea
              name="notes"
              maxLength={500}
              placeholder="Gate, landmark, handling instructions"
            />
          </label>
          {error && <p className="error span-2">{error}</p>}
          <div className="form-actions span-2">
            <button type="button" className="button ghost" onClick={close}>
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Creating…" : "Create delivery"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
