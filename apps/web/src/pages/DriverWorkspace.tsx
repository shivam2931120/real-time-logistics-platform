import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Camera,
  ChevronRight,
  LogOut,
  MapPinned,
  PackageCheck,
  Radio,
  QrCode,
  Route,
  ScanLine,
} from "lucide-react";
import type {
  Driver,
  ExceptionType,
  Order,
  OrderStatus,
  User,
} from "@routepulse/shared";
import { api } from "../lib/api";
import { readCurrentLocation, watchLocation } from "../lib/geolocation";
import { locationQueue, type QueuedLocation } from "../lib/locationQueue";
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
  const [driver, setDriver] = useState<Driver | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [syncState, setSyncState] = useState<"live" | "offline" | "syncing" | "queued">("live");
  const queue = useMemo(() => locationQueue(user.id), [user.id]);
  useEffect(() => {
    let cancelled = false;
    void api
      .driverMe()
      .then((value) => {
        if (!cancelled) {
          setDriver(value);
          setQueueSize(queue.count());
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setLocationError(reason instanceof Error ? reason.message : "Driver profile unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [queue]);
  useEffect(() => {
    if (!sharing || !driver) {
      setLocationError("");
      return;
    }
    let stopped = false;
    const send = async (reading: QueuedLocation) => {
      if (stopped) return;
      if (!navigator.onLine) {
        setQueueSize(queue.enqueue(reading));
        setSyncState("offline");
        return;
      }
      try {
        const result = await api.updateDriverLocation(driver.id, reading);
        if (stopped) return;
        setQueueSize(queue.count());
        setDriver((current) =>
          current
            ? { ...current, location: result.location, lastSeenAt: result.lastSeenAt }
            : current,
        );
        setSyncState("live");
        setLocationError("");
      } catch (reason) {
        if (stopped) return;
        setQueueSize(queue.enqueue(reading));
        setSyncState("queued");
        setLocationError(
          reason instanceof Error
            ? `${reason.message} Location is queued for retry.`
            : "Location is queued for retry while the API is unavailable.",
        );
      }
    };
    const flush = async () => {
      if (!navigator.onLine || stopped) return;
      setSyncState("syncing");
      const result = await queue.flush((reading) => api.updateDriverLocation(driver.id, reading));
      if (stopped) return;
      setQueueSize(result.remaining);
      setSyncState(result.remaining ? "queued" : "live");
    };
    const online = () => void flush();
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      void readCurrentLocation()
        .then((reading) =>
          send({
            ...reading,
            source: "browser-gps-visibility",
            recordedAt: new Date(reading.timestamp).toISOString(),
          }),
        )
        .catch(() => undefined);
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    void flush();
    const watchId = watchLocation(
      (position) => {
        if (stopped) return;
        void send({
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          source: "browser-gps",
          recordedAt: new Date(position.timestamp).toISOString(),
        });
      },
      (message) => {
        if (!stopped) setLocationError(message);
      },
    );
    return () => {
      stopped = true;
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      if (watchId !== null && navigator.geolocation)
        navigator.geolocation.clearWatch(watchId);
    };
  }, [driver, queue, sharing]);
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
          {sharing && (
            <p className="location-sync-status" role="status">
              {syncState === "offline"
                ? "Offline — fixes are being queued"
                : syncState === "syncing"
                  ? "Syncing queued fixes…"
                  : syncState === "queued"
                    ? `${queueSize} fix${queueSize === 1 ? "" : "es"} queued for retry`
                    : "Live GPS synced"}
            </p>
          )}
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
        <LiveMap drivers={driver ? [driver] : []} orders={[active]} selectedDriverId={driver?.id} />
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
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!camera) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    const detectorRuntime = globalThis as typeof globalThis & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
      };
    };
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera access is not available on this device.");
        return;
      }
      if (!detectorRuntime.BarcodeDetector) {
        setCameraError("QR detection is not supported here. Enter the parcel code manually.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new detectorRuntime.BarcodeDetector({ formats: ["qr_code"] });
        const poll = async () => {
          if (stopped || !videoRef.current) return;
          const result = await detector.detect(videoRef.current).catch(() => []);
          const raw = result.find((item) => item.rawValue)?.rawValue;
          if (raw) {
            setCode(raw);
            setCamera(false);
            return;
          }
          window.requestAnimationFrame(() => void poll());
        };
        void poll();
      } catch {
        setCameraError("Camera permission was denied. Enter the parcel code manually.");
      }
    };
    void start();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [camera]);
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
            Parcel QR / tracking code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
          <div className="form-actions span-2">
            <button type="button" className="button ghost" onClick={() => { setCameraError(""); setCamera((value) => !value); }}>
              <QrCode /> {camera ? "Close QR camera" : "Scan QR with camera"}
            </button>
          </div>
          {camera && <video ref={videoRef} className="qr-camera" muted playsInline />}
          {cameraError && <p className="inline-notice warning span-2">{cameraError}</p>}
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
  const [signatureData, setSignatureData] = useState("");
  const [photoData, setPhotoData] = useState<string | undefined>();
  const [localError, setLocalError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const readPhoto = (file: File) => {
    if (file.size > 900_000) {
      setLocalError("Choose a photo smaller than 900 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoData(typeof reader.result === "string" ? reader.result : undefined);
    reader.readAsDataURL(file);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pin = String(form.get("pin") || "").trim();
    const parcelCode = String(form.get("parcelCode") || "").trim();
    if (!pin && !parcelCode) {
      setLocalError("Enter the recipient PIN or scan the parcel QR code.");
      return;
    }
    if (!signatureData && !photoData) {
      setLocalError("Capture a signature or delivery photo before completing.");
      return;
    }
    try {
      await api.proof(order.id, {
        recipientName: String(form.get("name")),
        recipientPin: pin || undefined,
        parcelCode: parcelCode || undefined,
        signatureData: signatureData || undefined,
        photoData,
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
              pattern="[0-9]{4,6}"
              inputMode="numeric"
              placeholder="1234"
            />
          </label>
          <label>
            Parcel QR code
            <input name="parcelCode" placeholder="Scan or enter code" />
          </label>
          <div className="span-2 proof-capture">
            <span className="field-caption">Recipient signature</span>
            <SignaturePad value={signatureData} onChange={setSignatureData} />
          </div>
          <div className="span-2 proof-photo">
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readPhoto(file);
              }}
            />
            <button type="button" className="button ghost" onClick={() => photoInput.current?.click()}>
              <Camera /> {photoData ? "Retake delivery photo" : "Capture delivery photo"}
            </button>
            {photoData && <img src={photoData} alt="Delivery proof preview" />}
          </div>
          {localError && <p className="error span-2" role="alert">{localError}</p>}
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

function SignaturePad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };
  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };
  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={720}
        height={240}
        aria-label="Draw recipient signature"
        onPointerDown={(event) => {
          const canvas = event.currentTarget;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          drawing.current = true;
          canvas.setPointerCapture(event.pointerId);
          const { x, y } = point(event);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = event.currentTarget.getContext("2d");
          if (!ctx) return;
          const { x, y } = point(event);
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#102019";
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={(event) => {
          if (!drawing.current) return;
          drawing.current = false;
          const canvas = event.currentTarget;
          onChange(canvas.toDataURL("image/png"));
        }}
        onPointerLeave={() => { drawing.current = false; }}
      />
      <button type="button" className="button ghost" onClick={clear} disabled={!value}>Clear signature</button>
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
