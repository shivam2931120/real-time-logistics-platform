import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  LogOut,
  MapPinned,
  PackageCheck,
  Radio,
  Route,
  ScanLine,
} from "lucide-react";
import { io } from "socket.io-client";
import type {
  ExceptionType,
  Order,
  OrderStatus,
  User,
} from "@routepulse/shared";
import { api } from "../lib/api";
import { watchLocation } from "../lib/geolocation";
import { LiveMap } from "../components/LiveMap";

const next: Partial<Record<OrderStatus, OrderStatus>> = {
  assigned: "picked_up",
  picked_up: "in_transit",
};
const Status = ({ value }: { value: string }) => (
  <span className={`status ${value}`}>
    <i />
    {value.replace("_", " ")}
  </span>
);

export function DriverWorkspace({
  user,
  orders,
  reload,
  logout,
}: {
  user: User;
  orders: Order[];
  reload: () => void;
  logout: () => void;
}) {
  const active = orders.find(
    (order) => !["delivered", "failed", "cancelled"].includes(order.status),
  );
  const [sharing, setSharing] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [proof, setProof] = useState(false);
  const [issue, setIssue] = useState(false);
  const [error, setError] = useState("");
  const [scanner, setScanner] = useState(false);
  useEffect(() => {
    if (!sharing) {
      setLocationError("");
      return;
    }
    const socket = io(api.base, { auth: api.socketAuth });
    let stopped = false;
    const watchId = watchLocation(
      (position) => {
        if (stopped) return;
        socket.emit("location:update", {
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          source: "browser-gps",
        });
        setLocationError("");
      },
      (message) => {
        if (!stopped) setLocationError(message);
      },
    );
    return () => {
      stopped = true;
      if (watchId !== null && navigator.geolocation)
        navigator.geolocation.clearWatch(watchId);
      socket.close();
    };
  }, [sharing]);
  if (!active)
    return (
      <main className="driver-app">
        <DriverHeader logout={logout} />
        <section className="empty">
          <PackageCheck />
          <h2>You&apos;re all caught up</h2>
          <p>New assignments will appear here automatically.</p>
        </section>
      </main>
    );
  const accepted = active.events.some((event) => event.type === "accepted");
  const advance = async () => {
    const status = next[active.status];
    if (status) {
      await api.status(active.id, status);
      await reload();
    } else if (active.status === "in_transit") setProof(true);
  };
  const reject = async () => {
    const reason = window.prompt("Why can you not take this delivery?");
    if (!reason) return;
    await api.reject(active.id, reason);
    await reload();
  };
  return (
    <main className="driver-app">
      <DriverHeader logout={logout} />
      <section className="driver-greeting">
        <span className="eyebrow">Driver workspace</span>
        <h1>Ready to move, {user.name.split(" ")[0]}?</h1>
        <div className="driver-tools">
          <button
            className={`share ${sharing ? "on" : ""}`}
            onClick={() => setSharing(!sharing)}
          >
            <Radio />
            {sharing ? "Location sharing on" : "Start location sharing"}
          </button>
          {locationError && (
            <p className="inline-notice warning">{locationError}</p>
          )}
          <a
            className="share"
            target="_blank"
            rel="noreferrer"
            href={`https://www.google.com/maps/dir/?api=1&destination=${active.dropoff.lat},${active.dropoff.lng}`}
          >
            <MapPinned />
            Navigate
          </a>
          <button className="share" onClick={() => setScanner(true)}>
            <ScanLine /> Scan parcel
          </button>
        </div>
      </section>
      <section className="driver-map">
        <LiveMap drivers={[]} orders={[active]} />
        <div className="next-stop">
          <span>Next stop</span>
          <strong>{active.dropoff.label}</strong>
          <small>
            {active.customerName} · {active.packageWeightKg} kg ·{" "}
            {active.priority}
          </small>
        </div>
      </section>
      <section className="driver-card">
        <div>
          <span className="eyebrow">{active.trackingCode}</span>
          <Status value={active.status} />
        </div>
        {active.lateRisk && (
          <p className="late-warning">
            <AlertTriangle />
            This delivery is at risk of missing its promised window.
          </p>
        )}
        <div className="route-line">
          <span>A</span>
          <div>
            <small>Collect from</small>
            <strong>{active.pickup.label}</strong>
          </div>
          <i />
          <span>B</span>
          <div>
            <small>Deliver to</small>
            <strong>{active.dropoff.label}</strong>
          </div>
        </div>
        {active.deliveryNotes && (
          <div className="delivery-notes">
            <strong>Delivery notes</strong>
            <p>{active.deliveryNotes}</p>
          </div>
        )}
        {active.status === "assigned" && !accepted ? (
          <div className="driver-actions">
            <button className="button ghost" onClick={() => void reject()}>
              Decline
            </button>
            <button
              className="button primary"
              onClick={async () => {
                await api.accept(active.id);
                await reload();
              }}
            >
              <CheckCircle2 />
              Accept job
            </button>
          </div>
        ) : (
          <button
            className="button primary full"
            onClick={() => void advance()}
          >
            {active.status === "assigned"
              ? "Confirm pickup"
              : active.status === "picked_up"
                ? "Start delivery"
                : "Complete delivery"}
            <ChevronRight />
          </button>
        )}
        <button className="report-issue" onClick={() => setIssue(true)}>
          <AlertTriangle />
          Report a delivery issue
        </button>
        {error && <p className="error">{error}</p>}
      </section>
      {proof && (
        <ProofModal
          order={active}
          close={() => setProof(false)}
          saved={reload}
          fail={setError}
        />
      )}{" "}
      {issue && (
        <IssueModal
          order={active}
          close={() => setIssue(false)}
          saved={reload}
          fail={setError}
        />
      )}
      {scanner && (
        <ScanModal
          order={active}
          close={() => setScanner(false)}
          saved={reload}
          fail={setError}
        />
      )}
    </main>
  );
}

function ScanModal({
  order,
  close,
  saved,
  fail,
}: {
  order: Order;
  close: () => void;
  saved: () => void;
  fail: (message: string) => void;
}) {
  const [stage, setStage] = useState<"pickup" | "hub" | "delivery">(
    order.status === "assigned"
      ? "pickup"
      : order.status === "picked_up"
        ? "hub"
        : "delivery",
  );
  const [code, setCode] = useState(order.parcelCode || order.trackingCode);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await api.scan(order.id, { parcelCode: code, stage });
      close();
      await saved();
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Unable to record scan");
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal compact-modal">
        <span className="eyebrow">Chain of custody</span>
        <h2>Scan parcel</h2>
        <form className="form-grid" onSubmit={submit}>
          <label className="span-2">
            Parcel code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
          <label className="span-2">
            Stage
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value as typeof stage)}
            >
              <option value="pickup">Pickup</option>
              <option value="hub">Hub</option>
              <option value="delivery">Delivery</option>
            </select>
          </label>
          <div className="form-actions span-2">
            <button type="button" className="button ghost" onClick={close}>
              Cancel
            </button>
            <button className="button primary">
              <ScanLine /> Record scan
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DriverHeader({ logout }: { logout: () => void }) {
  return (
    <header>
      <div className="brand">
        <img className="brand-logo" src="/logo.png" alt="RoutePulse" />
      </div>
      <button className="icon-btn" aria-label="Sign out" onClick={logout}>
        <LogOut />
      </button>
    </header>
  );
}
function ProofModal({
  order,
  close,
  saved,
  fail,
}: {
  order: Order;
  close: () => void;
  saved: () => void;
  fail: (value: string) => void;
}) {
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.proof(order.id, {
        recipientName: String(form.get("name")),
        recipientPin: String(form.get("pin")),
        signatureData: `typed:${String(form.get("signature"))}`,
      });
      close();
      await saved();
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Unable to save proof");
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal compact-modal">
        <span className="eyebrow">Proof of delivery</span>
        <h2>Confirm recipient</h2>
        <form onSubmit={submit} className="form-grid">
          <label className="span-2">
            Recipient name
            <input name="name" required minLength={2} />
          </label>
          <label>
            Delivery PIN
            <input
              name="pin"
              required
              pattern="[0-9]{4,6}"
              inputMode="numeric"
            />
          </label>
          <label>
            Signature
            <input
              name="signature"
              required
              minLength={3}
              placeholder="Type recipient name"
            />
          </label>
          <div className="form-actions span-2">
            <button type="button" className="button ghost" onClick={close}>
              Cancel
            </button>
            <button className="button primary">
              <CheckCircle2 />
              Complete delivery
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function IssueModal({
  order,
  close,
  saved,
  fail,
}: {
  order: Order;
  close: () => void;
  saved: () => void;
  fail: (value: string) => void;
}) {
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.createException(
        order.id,
        String(form.get("type")) as ExceptionType,
        String(form.get("description")),
      );
      close();
      await saved();
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Unable to report issue");
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal compact-modal">
        <span className="eyebrow">Exception workflow</span>
        <h2>Report an issue</h2>
        <form onSubmit={submit} className="form-grid">
          <label className="span-2">
            Issue type
            <select name="type">
              <option value="delay">Delay</option>
              <option value="address_issue">Address issue</option>
              <option value="customer_unavailable">Customer unavailable</option>
              <option value="vehicle_issue">Vehicle issue</option>
              <option value="package_issue">Package issue</option>
              <option value="delivery_failed">Delivery failed</option>
            </select>
          </label>
          <label className="span-2">
            Description
            <textarea name="description" minLength={3} required />
          </label>
          <div className="form-actions span-2">
            <button type="button" className="button ghost" onClick={close}>
              Cancel
            </button>
            <button className="button primary">
              <Route />
              Submit issue
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
