import { useRef, useState } from "react";
import { CheckCircle2, MapPin, Search, X } from "lucide-react";
import { api, type MapSearchResult } from "../lib/api";
import { useDialog } from "../lib/useDialog";
export function CreateOrder({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [destination, setDestination] = useState("");
  const [coordinates, setCoordinates] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [places, setPlaces] = useState<MapSearchResult[]>([]);
  const [finding, setFinding] = useState(false);
  const [searched, setSearched] = useState(false);
  const [manual, setManual] = useState(false);
  const requestId = useRef(0);
  const dialogRef = useDialog(true, () => {
    if (!busy) close();
  });
  const findAddress = async () => {
    if (destination.trim().length < 3) return;
    const currentRequest = ++requestId.current;
    setFinding(true);
    setError("");
    try {
      const results = await api.mapSearch(destination.trim());
      if (currentRequest !== requestId.current) return;
      setPlaces(results);
      setSearched(true);
    } catch (reason) {
      if (currentRequest !== requestId.current) return;
      setPlaces([]);
      setError(
        reason instanceof Error ? reason.message : "Unable to find address",
      );
    } finally {
      if (currentRequest === requestId.current) setFinding(false);
    }
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const location = manual
      ? { lat: Number(f.get("latitude")), lng: Number(f.get("longitude")) }
      : coordinates;
    if (
      !location ||
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng) ||
      Math.abs(location.lat) > 90 ||
      Math.abs(location.lng) > 180 ||
      (manual && (!f.get("latitude") || !f.get("longitude")))
    ) {
      setError(
        "Choose an address result or enter valid latitude and longitude.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const start = String(f.get("windowStart") || "");
    try {
      await api.create({
        customerName: f.get("name"),
        customerEmail: f.get("email"),
        pickup: { label: "Indiranagar Hub", lat: 12.9784, lng: 77.6408 },
        dropoff: {
          label: destination.trim(),
          lat: location.lat,
          lng: location.lng,
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
        ref={dialogRef}
        tabIndex={-1}
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
          <button
            className="icon-btn"
            onClick={close}
            disabled={busy}
            aria-label="Close"
          >
            <X />
          </button>
        </div>
        <form onSubmit={submit} className="form-grid">
          <label>
            Customer name
            <input
              name="name"
              data-dialog-autofocus
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
          <div className="span-2 destination-field">
            <label htmlFor="delivery-destination">Destination</label>
            <div className="destination-search">
              <MapPin aria-hidden="true" />
              <input
                id="delivery-destination"
                value={destination}
                required
                maxLength={160}
                placeholder="Search an address or landmark"
                onChange={(event) => {
                  setDestination(event.target.value);
                  setCoordinates(null);
                  setPlaces([]);
                  setSearched(false);
                  requestId.current++;
                  setFinding(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void findAddress();
                  }
                }}
              />
              <button
                type="button"
                className="button ghost"
                disabled={finding || destination.trim().length < 3}
                onClick={() => void findAddress()}
              >
                <Search /> {finding ? "Finding…" : "Find"}
              </button>
            </div>
            {places.length > 0 && (
              <div className="place-results" aria-label="Address suggestions">
                {places.map((place) => (
                  <button
                    type="button"
                    key={place.id}
                    onClick={() => {
                      setDestination(place.label.slice(0, 160));
                      setCoordinates({ lat: place.lat, lng: place.lng });
                      setPlaces([]);
                      setManual(false);
                      setError("");
                    }}
                  >
                    <MapPin />
                    <span>
                      <strong>{place.label.split(",")[0]}</strong>
                      <small>{place.label}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {coordinates && !manual && (
              <div className="verified-location">
                <CheckCircle2 /> Address selected · {coordinates.lat.toFixed(4)}
                , {coordinates.lng.toFixed(4)}
              </div>
            )}
            {searched && !finding && !places.length && !coordinates && (
              <p role="status">
                No addresses found. Try a nearby landmark or enter coordinates
                below.
              </p>
            )}
            <label className="manual-location-toggle">
              <input
                type="checkbox"
                checked={manual}
                onChange={(event) => setManual(event.target.checked)}
              />
              Enter coordinates manually
            </label>
            {manual && (
              <div className="form-grid">
                <label>
                  Latitude
                  <input
                    name="latitude"
                    required
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    defaultValue={coordinates?.lat}
                  />
                </label>
                <label>
                  Longitude
                  <input
                    name="longitude"
                    required
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    defaultValue={coordinates?.lng}
                  />
                </label>
                <small className="span-2">
                  Use coordinates from your delivery location. Address search is
                  optional in this mode.
                </small>
              </div>
            )}
          </div>
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
          {error && (
            <p className="error span-2" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions span-2">
            <button
              type="button"
              className="button ghost"
              onClick={close}
              disabled={busy}
            >
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
