import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ScanLine } from "lucide-react";
import type {
  Order,
  ParcelScan,
  ParcelScanStage,
  Role,
} from "@routepulse/shared";
import { api } from "../lib/api";

const stages: ParcelScanStage[] = ["pickup", "hub", "delivery"];

export function ParcelScannerPage({
  orders,
  role,
}: {
  orders: Order[];
  role: Role;
}) {
  const available = useMemo(
    () =>
      orders.filter(
        (order) => !["delivered", "cancelled"].includes(order.status),
      ),
    [orders],
  );
  const [orderId, setOrderId] = useState(available[0]?.id ?? "");
  const [stage, setStage] = useState<ParcelScanStage>("pickup");
  const [code, setCode] = useState(
    available[0]?.parcelCode || available[0]?.trackingCode || "",
  );
  const [history, setHistory] = useState<ParcelScan[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selected = available.find((order) => order.id === orderId);

  useEffect(() => {
    if (!orderId && available[0]) setOrderId(available[0].id);
  }, [available, orderId]);
  useEffect(() => {
    if (!selected) return;
    setCode(selected.parcelCode || selected.trackingCode);
    void api
      .scans(selected.id)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [selected]);
  useEffect(() => {
    if (!cameraOpen || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled)
          return stream.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() =>
        setError(
          "Camera permission was not granted; enter the parcel code manually.",
        ),
      );
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOpen]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    setError("");
    setSaved("");
    try {
      const scan = await api.scan(selected.id, { parcelCode: code, stage });
      setHistory((items) => [
        scan,
        ...items.filter((item) => item.stage !== scan.stage),
      ]);
      setSaved(`${stage[0].toUpperCase()}${stage.slice(1)} scan recorded`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to record scan",
      );
    }
  };
  return (
    <section className="scanner-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Operations / parcel control</span>
          <h1>Parcel scanner</h1>
          <p>
            Record chain-of-custody scans at pickup, hub, and delivery. Manual
            entry remains available on every device.
          </p>
        </div>
        <span className="technical-badge">
          <ScanLine /> {role.toUpperCase()} ACCESS
        </span>
      </div>
      <div className="scanner-layout">
        <form className="panel scanner-form" onSubmit={submit}>
          <div className="panel-head">
            <div>
              <span className="eyebrow">New scan</span>
              <h3>Identify a parcel</h3>
            </div>
            <ScanLine />
          </div>
          {!available.length ? (
            <p className="muted">
              No active deliveries are available for scanning.
            </p>
          ) : (
            <>
              <label>
                Delivery
                <select
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value)}
                >
                  {available.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.trackingCode} · {order.customerName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Scan stage
                <select
                  value={stage}
                  onChange={(event) =>
                    setStage(event.target.value as ParcelScanStage)
                  }
                >
                  {stages.map((value) => (
                    <option key={value} value={value}>
                      {value[0].toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Parcel / tracking code
                <input
                  required
                  minLength={3}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="PKG-RP-DEMO01"
                />
              </label>
              <div className="scanner-camera">
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => setCameraOpen((value) => !value)}
                >
                  <Camera /> {cameraOpen ? "Close camera" : "Use camera"}
                </button>
                {cameraOpen && (
                  <>
                    <video ref={videoRef} autoPlay muted playsInline />
                    <small>
                      Camera preview is active. BarcodeDetector support varies
                      by browser; use the code field when auto-detection is
                      unavailable.
                    </small>
                  </>
                )}
              </div>
              {error && <p className="error">{error}</p>}
              {saved && (
                <p className="success-message">
                  <CheckCircle2 /> {saved}
                </p>
              )}
              <button className="button primary full" type="submit">
                <ScanLine /> Record scan
              </button>
            </>
          )}
        </form>
        <section className="panel scan-history">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Chain of custody</span>
              <h3>Recent scans</h3>
            </div>
            <span className="technical-badge">{history.length} EVENTS</span>
          </div>
          {history.length ? (
            <ol className="scan-list">
              {history.map((scan) => (
                <li key={scan.id}>
                  <span className={`scan-stage ${scan.stage}`}>
                    <ScanLine />
                  </span>
                  <div>
                    <strong>{scan.stage.toUpperCase()}</strong>
                    <small>
                      {scan.parcelCode} ·{" "}
                      {new Date(scan.scannedAt).toLocaleString()}
                    </small>
                  </div>
                  <CheckCircle2 />
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <ScanLine />
              <strong>No scans yet</strong>
              <span>Recorded scans will appear here.</span>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
