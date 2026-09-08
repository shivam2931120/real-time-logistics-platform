import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  MapPin,
  PackageSearch,
  Radio,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { io } from "socket.io-client";
import type { Driver, Order, TrackingSnapshot } from "@routepulse/shared";
import { api } from "../lib/api";
import { LiveMap } from "../components/LiveMap";

const statusSteps = [
  "pending",
  "assigned",
  "picked_up",
  "in_transit",
  "delivered",
];

export function TrackingPage() {
  const pathCode = decodeURIComponent(
    window.location.pathname.split("/")[2] || "",
  ).toUpperCase();
  const [code, setCode] = useState(pathCode);
  const [tracking, setTracking] = useState<TrackingSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(pathCode));
  const load = async (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.track(normalized);
      setTracking(data);
      setCode(normalized);
      window.history.replaceState(
        {},
        "",
        `/track/${encodeURIComponent(normalized)}`,
      );
    } catch (reason) {
      setTracking(null);
      setError(
        reason instanceof Error ? reason.message : "Tracking is unavailable",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (pathCode) void load(pathCode);
  }, []);
  useEffect(() => {
    if (!tracking) return;
    const socket = io(api.base, {
      auth: { trackingCode: tracking.trackingCode },
    });
    socket.on(
      "driver:location",
      (update: { location: Driver["location"]; lastSeenAt: string }) =>
        setTracking((current) =>
          current
            ? {
                ...current,
                driver: current.driver
                  ? {
                      ...current.driver,
                      location: update.location,
                      lastSeenAt: update.lastSeenAt,
                    }
                  : null,
              }
            : current,
        ),
    );
    socket.on("order:updated", () => void load(tracking.trackingCode));
    return () => {
      socket.close();
    };
  }, [tracking?.trackingCode]);
  const mapData = useMemo(() => {
    if (!tracking) return null;
    const order: Order = {
      id: tracking.trackingCode,
      organizationId: "public",
      trackingCode: tracking.trackingCode,
      customerName: tracking.customerName,
      customerEmail: "",
      pickup: tracking.pickup,
      dropoff: tracking.dropoff,
      packageWeightKg: 1,
      priority: tracking.priority,
      status: tracking.status,
      amount: 0,
      currency: "INR",
      paymentStatus: "unpaid",
      promisedAt: tracking.promisedAt,
      estimatedArrivalAt: tracking.estimatedArrivalAt,
      lateRisk: tracking.lateRisk,
      createdAt: tracking.events[0]?.createdAt || tracking.updatedAt,
      updatedAt: tracking.updatedAt,
      events: tracking.events.map((event, index) => ({
        ...event,
        id: String(index),
      })),
    };
    const driver: Driver | undefined = tracking.driver
      ? {
          id: "live-driver",
          userId: "public",
          name: tracking.driver.name,
          status: "busy",
          capacityKg: 1,
          location: tracking.driver.location,
          lastSeenAt: tracking.driver.lastSeenAt,
        }
      : undefined;
    return { order, drivers: driver ? [driver] : [] };
  }, [tracking]);
  const activeIndex = tracking
    ? Math.max(0, statusSteps.indexOf(tracking.status))
    : -1;
  return (
    <main className="tracking-page">
      <header>
        <a className="brand" href="/">
          <img className="brand-logo" src="/logo.png" alt="RoutePulse" />
        </a>
        <a className="button ghost" href="/#/sign-in" aria-label="Team sign in">
          Team sign in
        </a>
      </header>
      <section className="tracking-hero">
        <span className="eyebrow green">Live delivery tracking</span>
        <h1>Where is your package?</h1>
        <p>Enter your RoutePulse tracking code for a privacy-safe live view.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load(code);
          }}
        >
          <PackageSearch />
          <input
            aria-label="Tracking code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="RP-DEMO01"
          />
          <button className="button primary" disabled={loading}>
            {loading ? "Finding…" : "Track delivery"}
          </button>
        </form>
        {error && (
          <p className="tracking-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {tracking && mapData && (
        <section className="tracking-result">
          <div className="tracking-summary">
            <div>
              <span className="live-pill">
                <Radio />
                Live tracking
              </span>
              <h2>{tracking.trackingCode}</h2>
              <p>
                Hi {tracking.customerName}, your delivery is heading to{" "}
                <strong>{tracking.destination}</strong>.
              </p>
            </div>
            <div className={`eta-card${tracking.lateRisk ? " risk" : ""}`}>
              <Clock3 />
              <span>
                <small>
                  {tracking.lateRisk ? "Delay risk" : "Estimated arrival"}
                </small>
                <strong>
                  {tracking.estimatedArrivalAt
                    ? new Date(tracking.estimatedArrivalAt).toLocaleTimeString(
                        [],
                        { hour: "2-digit", minute: "2-digit" },
                      )
                    : new Date(tracking.promisedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                </strong>
              </span>
            </div>
          </div>
          <div className="tracking-grid">
            <article className="panel tracking-map">
              <LiveMap drivers={mapData.drivers} orders={[mapData.order]} />
            </article>
            <article className="panel tracking-details">
              <div className="tracking-driver">
                <span>{tracking.driver ? <Truck /> : <PackageSearch />}</span>
                <div>
                  <small>
                    {tracking.driver ? "Your driver" : "Driver assignment"}
                  </small>
                  <strong>{tracking.driver?.name || "Being assigned"}</strong>
                  {tracking.driver && (
                    <p>
                      <MapPin />
                      Updated{" "}
                      {new Date(tracking.driver.lastSeenAt).toLocaleTimeString(
                        [],
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </p>
                  )}
                </div>
              </div>
              <ol className="tracking-steps">
                {statusSteps.map((step, index) => (
                  <li
                    className={index <= activeIndex ? "complete" : ""}
                    key={step}
                  >
                    {index < activeIndex ? <CheckCircle2 /> : <span />}
                    <div>
                      <strong>{step.replace("_", " ")}</strong>
                      <small>
                        {index === activeIndex
                          ? "Current stage"
                          : index < activeIndex
                            ? "Completed"
                            : "Upcoming"}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
              {tracking.proof && (
                <div className="proof-confirmed">
                  <ShieldCheck />
                  <div>
                    <strong>Proof of delivery recorded</strong>
                    <small>
                      Received by {tracking.proof.recipientName} at{" "}
                      {new Date(tracking.proof.createdAt).toLocaleString()}
                    </small>
                  </div>
                </div>
              )}
            </article>
          </div>
          <article className="panel public-timeline">
            <h3>Delivery timeline</h3>
            {[...tracking.events].reverse().map((event, index) => (
              <div key={`${event.createdAt}-${index}`}>
                <i />
                <span>
                  <strong>{event.message}</strong>
                  <small>{new Date(event.createdAt).toLocaleString()}</small>
                </span>
              </div>
            ))}
          </article>
        </section>
      )}
    </main>
  );
}
