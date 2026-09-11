import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalyticsSummary,
  Driver,
  Order,
  OrderStatus,
  OrganizationSettings,
  Role,
  User,
} from "@routepulse/shared";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Box,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  Plus,
  Radio,
  RefreshCw,
  Route,
  ScanLine,
  Search,
  LifeBuoy,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { io } from "socket.io-client";
import { ApiError, api } from "./lib/api";
import { watchLocation } from "./lib/geolocation";
const LiveMap = lazy(() => import("./components/LiveMap").then((module) => ({ default: module.LiveMap })));
const CreateOrder = lazy(() => import("./components/CreateOrder").then((module) => ({ default: module.CreateOrder })));
const DeliveriesPage = lazy(() => import("./pages/DeliveriesPage").then((module) => ({ default: module.DeliveriesPage })));
const FleetPage = lazy(() => import("./pages/FleetPage").then((module) => ({ default: module.FleetPage })));
const RoutePlannerPage = lazy(() => import("./pages/RoutePlannerPage").then((module) => ({ default: module.RoutePlannerPage })));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const DispatchPage = lazy(() => import("./pages/DispatchPage").then((module) => ({ default: module.DispatchPage })));
const ExceptionsPage = lazy(() => import("./pages/ExceptionsPage").then((module) => ({ default: module.ExceptionsPage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const DriverWorkspace = lazy(() => import("./pages/DriverWorkspace").then((module) => ({ default: module.DriverWorkspace })));
const ParcelScannerPage = lazy(() => import("./pages/ParcelScannerPage").then((module) => ({ default: module.ParcelScannerPage })));
const SupportPage = lazy(() => import("./pages/SupportPage").then((module) => ({ default: module.SupportPage })));
import {
  CommandPalette,
  type CommandDestination,
} from "./components/CommandPalette";

const next: Partial<Record<OrderStatus, OrderStatus>> = {
  assigned: "picked_up",
  picked_up: "in_transit",
  in_transit: "delivered",
};
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
type View =
  | "overview"
  | "dispatch"
  | "deliveries"
  | "fleet"
  | "routes"
  | "exceptions"
  | "notifications"
  | "analytics"
  | "admin"
  | "scanner"
  | "support";
type NavItem = {
  id: View;
  label: string;
  description: string;
  group: "Operate" | "Monitor" | "Engage" | "System";
  icon: LucideIcon;
};
const viewDescriptions: Record<View, string> = {
  overview: "Live network health and today’s operational priorities",
  dispatch: "Match unassigned deliveries with capacity-ready drivers",
  deliveries: "Search, monitor, assign and export every shipment",
  fleet: "Driver availability, vehicles, shifts and live positioning",
  routes: "Build capacity-aware multi-stop delivery routes",
  exceptions: "Resolve delays, address issues and delivery risks",
  notifications: "Review delivery, payment and communication updates",
  analytics: "Understand SLA, route, driver and revenue performance",
  scanner: "Record parcel custody at pickup, hub and delivery",
  support: "Manage customer conversations and delivery questions",
  admin: "Configure access, operating rules and audit history",
};
const viewFromPath = (): View => {
  const value = window.location.pathname.replace(/^\//, "").split("/")[0];
  return [
    "overview",
    "dispatch",
    "deliveries",
    "fleet",
    "routes",
    "exceptions",
    "notifications",
    "analytics",
    "admin",
    "scanner",
    "support",
  ].includes(value)
    ? (value as View)
    : "overview";
};
function Login({ done }: { done: (u: User) => void }) {
  const [busy, setBusy] = useState<Role | null>(null),
    [error, setError] = useState("");
  const roles: [Role, string, string][] = [
    [
      "dispatcher",
      "Dispatch control",
      "Plan routes and manage live operations",
    ],
    ["driver", "Driver mobile", "Navigate and complete assigned stops"],
    ["admin", "Operations admin", "Manage the fleet and business performance"],
    ["customer", "Customer tracking", "Follow and pay for your delivery"],
  ];
  const enter = async (role: Role) => {
    setBusy(role);
    setError("");
    try {
      done(await api.login(role));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to connect to the RoutePulse API",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="login">
      <section className="login-brand">
        <div className="brand large">
          <img className="brand-logo" src="/logo.png" alt="RoutePulse" />
        </div>
        <div>
          <span className="eyebrow green">Real-time logistics OS</span>
          <h1>
            Every delivery.
            <br />
            <em>In motion.</em>
          </h1>
          <p>
            Dispatch faster, see the whole fleet live, and turn operational
            noise into clear decisions.
          </p>
        </div>
        <div className="signal">
          <span />
          <span />
          <span />
          <small>LIVE NETWORK</small>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">Interactive product demo</span>
          <h2>Choose your workspace</h2>
          <p>Enter with a seeded role. No password or setup required.</p>
          {error && (
            <p className="login-error" role="alert">
              {error}. Check that the API is running on port 4000, then try
              again.
            </p>
          )}
          <div className="role-list">
            {roles.map(([role, title, desc]) => (
              <button
                key={role}
                disabled={!!busy}
                onClick={() => void enter(role)}
              >
                <span className={`role-icon ${role}`}>
                  {role === "driver" ? (
                    <Truck />
                  ) : role === "customer" ? (
                    <Box />
                  ) : role === "admin" ? (
                    <Users />
                  ) : (
                    <Route />
                  )}
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
                <ChevronRight />
              </button>
            ))}
          </div>
          <p className="demo-note">
            <Radio /> Demo data · provider integrations are simulated until
            configured
          </p>
        </div>
      </section>
    </main>
  );
}
function ViewLoading({ label = "Loading workspace view…" }: { label?: string }) {
  return (
    <div className="view-loading" role="status" aria-live="polite">
      <div className="loading-pulse" />
      <strong>{label}</strong>
      <span>Preparing the latest operational data.</span>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value}`}>
      <i />
      {value.replace("_", " ")}
    </span>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [orders, setOrders] = useState<Order[]>([]),
    [drivers, setDrivers] = useState<Driver[]>([]),
    [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null),
    [organizationSettings, setOrganizationSettings] =
      useState<OrganizationSettings | null>(null),
    [loading, setLoading] = useState(true),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<Order | null>(null),
    [mobile, setMobile] = useState(false),
    [view, setView] = useState<View>(viewFromPath),
    [loadError, setLoadError] = useState(""),
    [realtime, setRealtime] = useState<"connecting" | "online" | "offline">(
      "connecting",
    ),
    [commandOpen, setCommandOpen] = useState(false),
    [commandQuery, setCommandQuery] = useState(""),
    [toast, setToast] = useState("");
  const loadedIdentity = useRef("");
  const loadInFlight = useRef<Promise<void> | null>(null);
  const load = useCallback(() => {
    if (loadInFlight.current) return loadInFlight.current;
    const task = (async () => {
      if (!api.token()) {
        setLoading(false);
        return;
      }
      setLoadError("");
      try {
        const me = await api.me();
        const identity = `${me.organizationId}:${me.id}:${me.role}`;
        if (loadedIdentity.current !== identity) {
          loadedIdentity.current = identity;
          setOrders([]);
          setDrivers([]);
          setAnalytics(null);
          setOrganizationSettings(null);
          setSelected(null);
          setCreate(false);
          setCommandOpen(false);
        }
        setUser(me);
        const os = await api.orders();
        setOrders(os);
        if (me.role === "admin" || me.role === "dispatcher") {
          const [driverResult, analyticsResult, settingsResult] =
            await Promise.allSettled([
              api.drivers(),
              api.analytics(),
              api.settings(),
            ]);
          if (driverResult.status === "fulfilled") setDrivers(driverResult.value);
          if (analyticsResult.status === "fulfilled")
            setAnalytics(analyticsResult.value);
          if (settingsResult.status === "fulfilled")
            setOrganizationSettings(settingsResult.value);
          const failed = [driverResult, analyticsResult, settingsResult].filter(
            (result) => result.status === "rejected",
          ).length;
          if (failed)
            setLoadError(
              `${failed} workspace section${failed === 1 ? "" : "s"} could not refresh. Existing data is still available.`,
            );
        }
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          api.logout();
          setUser(null);
        } else {
          setLoadError(
            reason instanceof Error
              ? reason.message
              : "Unable to refresh workspace data",
          );
        }
      } finally {
        setLoading(false);
      }
    })();
    loadInFlight.current = task;
    void task.then(
      () => {
        if (loadInFlight.current === task) loadInFlight.current = null;
      },
      () => {
        if (loadInFlight.current === task) loadInFlight.current = null;
      },
    );
    return task;
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const onPopState = () => setView(viewFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user) return;
    const socket = io(api.base, { auth: api.socketAuth });
    setRealtime("connecting");
    socket.on("connect", () => setRealtime("online"));
    socket.on("disconnect", () => setRealtime("offline"));
    socket.on("connect_error", () => setRealtime("offline"));
    socket.on("order:updated", (o: Order) =>
      setOrders((list) => list.map((x) => (x.id === o.id ? o : x))),
    );
    socket.on(
      "driver:location",
      (u: {
        driverId: string;
        location: Driver["location"];
        lastSeenAt: string;
      }) =>
        setDrivers((ds) =>
          ds.map((d) =>
            d.id === u.driverId
              ? { ...d, location: u.location, lastSeenAt: u.lastSeenAt }
              : d,
          ),
        ),
    );
    return () => {
      socket.close();
    };
  }, [user?.id]);
  const navigate = (nextView: View) => {
    const update = () => {
      if (window.location.pathname !== `/${nextView}`)
        window.history.pushState({}, "", `/${nextView}`);
      setView(nextView);
      setMobile(false);
      setCommandOpen(false);
      setCommandQuery("");
    };
    const transition = (
      document as Document & {
        startViewTransition?: (callback: () => void) => void;
      }
    ).startViewTransition;
    if (transition) transition.call(document, update);
    else update();
  };
  if (loading)
    return (
      <div className="workspace-loading" role="status">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="RoutePulse" />
        </div>
        <div className="loading-pulse" />
        <strong>Preparing your operations workspace</strong>
        <span>Syncing deliveries, fleet and live network data…</span>
      </div>
    );
  if (!user && loadError)
    return (
      <main className="splash load-failure" role="alert">
        <AlertTriangle />
        <h1>Workspace could not load</h1>
        <p>{loadError}</p>
        <button
          className="button primary"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          <RefreshCw /> Try again
        </button>
      </main>
    );
  if (!user)
    return (
      <Login
        done={(u) => {
          setUser(u);
          setLoading(true);
          load();
        }}
      />
    );
  if (user.role === "driver")
    return (
      <Suspense fallback={<ViewLoading label="Loading driver workspace…" />}>
        <DriverWorkspace
          user={user}
          orders={orders}
          reload={load}
          logout={() => {
            api.logout();
            setUser(null);
          }}
        />
      </Suspense>
    );
  if (user.role === "customer")
    return (
      <Suspense fallback={<ViewLoading label="Loading customer workspace…" />}>
        <CustomerView
          user={user}
          orders={orders}
          reload={load}
          logout={() => {
            api.logout();
            setUser(null);
          }}
        />
      </Suspense>
    );
  const nav: NavItem[] = [
    {
      id: "overview",
      label: "Overview",
      description: viewDescriptions.overview,
      group: "Operate",
      icon: Activity,
    },
    {
      id: "dispatch",
      label: "Dispatch board",
      description: viewDescriptions.dispatch,
      group: "Operate",
      icon: LayoutDashboard,
    },
    {
      id: "deliveries",
      label: "Deliveries",
      description: viewDescriptions.deliveries,
      group: "Operate",
      icon: PackageCheck,
    },
    {
      id: "routes",
      label: "Route planner",
      description: viewDescriptions.routes,
      group: "Operate",
      icon: Route,
    },
    {
      id: "scanner",
      label: "Parcel scanner",
      description: viewDescriptions.scanner,
      group: "Operate",
      icon: ScanLine,
    },
    {
      id: "fleet",
      label: "Fleet",
      description: viewDescriptions.fleet,
      group: "Monitor",
      icon: Truck,
    },
    {
      id: "exceptions",
      label: "Exceptions",
      description: viewDescriptions.exceptions,
      group: "Monitor",
      icon: AlertTriangle,
    },
    {
      id: "analytics",
      label: "Analytics",
      description: viewDescriptions.analytics,
      group: "Monitor",
      icon: BarChart3,
    },
    {
      id: "notifications",
      label: "Notifications",
      description: viewDescriptions.notifications,
      group: "Engage",
      icon: Bell,
    },
    {
      id: "support",
      label: "Support center",
      description: viewDescriptions.support,
      group: "Engage",
      icon: LifeBuoy,
    },
    ...(user.role === "admin"
      ? [
          {
            id: "admin",
            label: "Administration",
            description: viewDescriptions.admin,
            group: "System",
            icon: Settings,
          } satisfies NavItem,
        ]
      : []),
  ];
  const navGroups = (["Operate", "Monitor", "Engage", "System"] as const)
    .map((group) => ({
      group,
      items: nav.filter((item) => item.group === group),
    }))
    .filter(({ items }) => items.length);
  const commandDestinations: CommandDestination[] = nav.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    icon: item.icon,
  }));
  const currentView = nav.find((item) => item.id === view);
  const attentionCount = analytics?.openExceptions ?? 0;
  const kpis = [
    [
      "Fleet online",
      analytics?.activeDrivers ?? 0,
      `${drivers.filter((driver) => driver.status !== "offline").length} drivers active`,
      Truck,
    ],
    [
      "Deliveries today",
      analytics?.deliveriesToday ?? 0,
      "Live completion count",
      PackageCheck,
    ],
    [
      "On-time rate",
      `${analytics?.onTimeRate ?? 0}%`,
      "Promise adherence",
      Clock3,
    ],
    [
      "Revenue",
      money(analytics?.revenue ?? 0),
      "Captured payments",
      CircleDollarSign,
    ],
  ] as const;
  return (
    <div className="app-shell">
      <aside className={mobile ? "open" : ""}>
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="RoutePulse" />
        </div>
        <button className="close-nav" aria-label="Close navigation" onClick={() => setMobile(false)}>
          <X />
        </button>
        <nav aria-label="Primary navigation">
          {navGroups.map(({ group, items }) => (
            <div className="nav-group" key={group}>
              <span>{group}</span>
              {items.map(({ id, label, icon: Icon }) => (
                <button
                  className={view === id ? "active" : ""}
                  key={id}
                  onClick={() => navigate(id)}
                  aria-current={view === id ? "page" : undefined}
                >
                  <Icon />
                  <span>{label}</span>
                  {id === "deliveries" && (
                    <b>
                      {
                        orders.filter(
                          (order) =>
                            !["delivered", "cancelled"].includes(order.status),
                        ).length
                      }
                    </b>
                  )}
                  {id === "exceptions" && attentionCount > 0 && (
                    <b className="attention-count">{attentionCount}</b>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-bottom">
          <div className={`system ${realtime}`}>
            <span>{realtime === "online" ? <Wifi /> : <WifiOff />}</span>
            <div>
              <strong>
                {realtime === "online"
                  ? "Realtime connected"
                  : realtime === "connecting"
                    ? "Connecting…"
                    : "Realtime interrupted"}
              </strong>
              <small>
                {realtime === "online"
                  ? "Live updates are active"
                  : "Data can still be refreshed"}
              </small>
            </div>
          </div>
          <button
            onClick={() => {
              api.logout();
              setUser(null);
            }}
          >
            <LogOut />
            Sign out
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-backdrop"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="workspace">
        <header>
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            aria-expanded={mobile}
            onClick={() => setMobile(true)}
          >
            <Menu />
          </button>
          <div className="page-context">
            <h2>
              {currentView?.label ?? "Workspace"}
            </h2>
          </div>
          <div className="header-actions">
            <button
              className="global-search-trigger"
              type="button"
              onClick={() => setCommandOpen(true)}
            >
              <Search />
              <span>Search deliveries or pages</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-btn"
              onClick={() => navigate("notifications")}
              aria-label="Open notifications"
            >
              <Bell />
            </button>
            <div className="avatar">
              {user.name
                .split(" ")
                .map((x) => x[0])
                .join("")}
            </div>
            <div className="who">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
          </div>
        </header>
        <main>
          <Suspense fallback={<ViewLoading />}>
          {loadError && (
            <div className="workspace-notice" role="alert">
              <AlertTriangle />
              <span>
                <strong>Some data may be out of date</strong>
                <small>{loadError}</small>
              </span>
              <button type="button" onClick={() => void load()}>
                <RefreshCw /> Refresh
              </button>
            </div>
          )}
          {view === "overview" && (
            <>
              <section className="hero-row">
                <div>
                  <span className="live-pill">
                    <Radio /> LIVE OPERATIONS
                  </span>
                  <h1>Operations overview</h1>
                  <p>
                    {orders.filter((o) => o.status === "in_transit").length}{" "}
                    deliveries in transit ·{" "}
                    {orders.filter((o) => o.status === "pending").length}{" "}
                    awaiting dispatch
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setCreate(true)}
                >
                  <Plus /> New delivery
                </button>
              </section>
              <section className="focus-strip" aria-label="Operational focus">
                <button onClick={() => navigate("dispatch")}>
                  <span className="focus-icon pending">
                    <Clock3 />
                  </span>
                  <span>
                    <strong>
                      {
                        orders.filter((order) => order.status === "pending")
                          .length
                      }{" "}
                      awaiting dispatch
                    </strong>
                    <small>Assign ready deliveries to available drivers</small>
                  </span>
                  <ChevronRight />
                </button>
                <button onClick={() => navigate("exceptions")}>
                  <span className="focus-icon risk">
                    <AlertTriangle />
                  </span>
                  <span>
                    <strong>
                      {orders.filter((order) => order.lateRisk).length}{" "}
                      deliveries at risk
                    </strong>
                    <small>Review SLA exposure and open exceptions</small>
                  </span>
                  <ChevronRight />
                </button>
                <button onClick={() => navigate("routes")}>
                  <span className="focus-icon route">
                    <Route />
                  </span>
                  <span>
                    <strong>Plan the next route</strong>
                    <small>Sequence stops and validate vehicle capacity</small>
                  </span>
                  <ChevronRight />
                </button>
              </section>
              <section className="kpis">
                {kpis.map(([label, value, caption, Icon]) => (
                  <article key={label}>
                    <div className="kpi-top">
                      <span>{label}</span>
                      <span className="kpi-icon">
                        <Icon />
                      </span>
                    </div>
                    <strong>{value}</strong>
                    <small>{caption}</small>
                  </article>
                ))}
              </section>
              <section className="operations-grid">
                <article className="panel map-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">Fleet control</span>
                      <h3>Live operations</h3>
                    </div>
                    <span className="live-dot">
                      <i />
                      Live
                    </span>
                  </div>
                  <LiveMap
                    drivers={drivers}
                    orders={orders}
                    geofenceRadiusMeters={
                      organizationSettings?.geofenceRadiusMeters
                    }
                  />
                  <div className="map-legend">
                    <span>
                      <i className="available" />
                      Available
                    </span>
                    <span>
                      <i className="busy" />
                      On delivery
                    </span>
                    <span>
                      <i className="stop" />
                      Delivery stop
                    </span>
                  </div>
                </article>
                <article className="panel activity-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">Right now</span>
                      <h3>Active deliveries</h3>
                    </div>
                    <button onClick={() => navigate("deliveries")}>
                      View all
                    </button>
                  </div>
                  <div className="delivery-list">
                    {orders
                      .filter(
                        (o) => !["delivered", "cancelled"].includes(o.status),
                      )
                      .slice(0, 4)
                      .map((o) => (
                        <button key={o.id} onClick={() => setSelected(o)}>
                          <span className={`priority ${o.priority}`}>
                            {o.priority === "urgent"
                              ? "!"
                              : o.priority[0].toUpperCase()}
                          </span>
                          <span>
                            <strong>{o.customerName}</strong>
                            <small>
                              {o.trackingCode} · {o.dropoff.label}
                            </small>
                          </span>
                          <Status value={o.status} />
                        </button>
                      ))}
                    {!orders.some(
                      (order) =>
                        !["delivered", "cancelled"].includes(order.status),
                    ) && (
                      <div className="compact-empty">
                        <PackageCheck />
                        <strong>No active deliveries</strong>
                        <small>Create a delivery to start dispatching.</small>
                      </div>
                    )}
                  </div>
                </article>
              </section>
              <section className="bottom-grid">
                <article className="panel chart-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">Last 7 days</span>
                      <h3>Delivery volume</h3>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={analytics?.trend || []}>
                      <defs>
                        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor="#06b6d4"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#06b6d4"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.slice(5)}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="deliveries"
                        stroke="#06b6d4"
                        strokeWidth={3}
                        fill="url(#area)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </article>
                <article className="panel fleet-list">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">Fleet</span>
                      <h3>Driver availability</h3>
                    </div>
                  </div>
                  {drivers.map((d) => (
                    <div className="driver" key={d.id}>
                      <div className="driver-avatar">{d.name[0]}</div>
                      <div>
                        <strong>{d.name}</strong>
                        <small>{d.capacityKg} kg capacity</small>
                      </div>
                      <Status value={d.status} />
                    </div>
                  ))}
                  {!drivers.length && (
                    <div className="compact-empty">
                      <Truck />
                      <strong>No drivers available</strong>
                      <small>
                        Drivers appear when accounts receive the driver role.
                      </small>
                    </div>
                  )}
                </article>
              </section>
            </>
          )}
          {view === "dispatch" && (
            <DispatchPage
              orders={orders}
              drivers={drivers}
              geofenceRadiusMeters={organizationSettings?.geofenceRadiusMeters}
              assign={async (orderId, driverId) => {
                await api.assign(orderId, driverId);
                await load();
                setToast("Delivery assigned successfully");
              }}
            />
          )}
          {view === "deliveries" && (
            <DeliveriesPage
              orders={orders}
              drivers={drivers}
              geofenceRadiusMeters={organizationSettings?.geofenceRadiusMeters}
              create={() => setCreate(true)}
              select={setSelected}
              assign={async (id) => {
                await api.assign(id);
                await load();
                setToast("Delivery auto-assigned successfully");
              }}
              exportCsv={async () => {
                await api.downloadReport(
                  "/api/reports/orders.csv",
                  "routepulse-orders.csv",
                );
                setToast("Delivery report downloaded");
              }}
            />
          )}
          {view === "fleet" && (
            <FleetPage
              drivers={drivers}
              orders={orders}
              reload={load}
              geofenceRadiusMeters={organizationSettings?.geofenceRadiusMeters}
            />
          )}{" "}
          {view === "routes" && (
            <RoutePlannerPage
              drivers={drivers}
              orders={orders}
              geofenceRadiusMeters={organizationSettings?.geofenceRadiusMeters}
            />
          )}{" "}
          {view === "exceptions" && <ExceptionsPage orders={orders} />}{" "}
          {view === "notifications" && <NotificationsPage />}{" "}
          {view === "analytics" && (
            <AnalyticsPage
              analytics={analytics}
              exportCsv={async (days) => {
                await api.downloadReport(
                  "/api/reports/summary.csv?days=" + days,
                  "routepulse-summary.csv",
                );
                setToast(days + "-day analytics report downloaded");
              }}
            />
          )}{" "}
          {view === "scanner" && (
            <ParcelScannerPage orders={orders} role={user.role} />
          )}{" "}
          {view === "support" && <SupportPage orders={orders} />}{" "}
          {view === "admin" && user.role === "admin" && <AdminPage />}
          {view === "admin" && user.role !== "admin" && (
            <section className="panel empty-state">
              <ShieldCheck />
              <h2>Administrator access required</h2>
              <p>Your current role cannot manage workspace settings.</p>
              <button
                className="button primary"
                onClick={() => navigate("overview")}
              >
                Return to overview
              </button>
            </section>
          )}
          </Suspense>
        </main>
      </div>
      {create && (
        <Suspense fallback={<ViewLoading label="Loading delivery form…" />}>
          <CreateOrder
            close={() => setCreate(false)}
            saved={() => {
              void load();
              setToast("Delivery created and ready for dispatch");
            }}
          />
        </Suspense>
      )}{" "}
      {selected && (
        <OrderDrawer
          order={orders.find((order) => order.id === selected.id) ?? selected}
          close={() => setSelected(null)}
          notify={setToast}
          reload={async () => {
            await load();
            setSelected(null);
          }}
        />
      )}
      <CommandPalette
        open={commandOpen}
        query={commandQuery}
        destinations={commandDestinations}
        orders={orders}
        canCreate
        onQueryChange={setCommandQuery}
        onClose={() => {
          setCommandOpen(false);
          setCommandQuery("");
        }}
        onNavigate={(id) => navigate(id as View)}
        onOrder={(order) => {
          setSelected(order);
          setCommandOpen(false);
          setCommandQuery("");
        }}
        onCreate={() => {
          setCreate(true);
          setCommandOpen(false);
          setCommandQuery("");
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <PackageCheck /> {toast}
        </div>
      )}
    </div>
  );
}
function OrdersTable({
  orders,
  select,
  assign,
}: {
  orders: Order[];
  select: (o: Order) => void;
  assign: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Delivery</th>
            <th>Customer</th>
            <th>Destination</th>
            <th>Service</th>
            <th>Status</th>
            <th>Payment</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <strong>{o.trackingCode}</strong>
                <small>
                  {new Date(o.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </td>
              <td>{o.customerName}</td>
              <td>{o.dropoff.label}</td>
              <td>
                <span className={`service ${o.priority}`}>{o.priority}</span>
              </td>
              <td>
                <Status value={o.status} />
              </td>
              <td>
                <Status value={o.paymentStatus} />
              </td>
              <td>
                <button
                  className="text-btn"
                  onClick={() =>
                    o.status === "pending" ? assign(o.id) : select(o)
                  }
                >
                  {o.status === "pending" ? "Auto assign" : "Details"}{" "}
                  <ChevronRight />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
async function loadRazorpay() {
  const existing = (window as unknown as { Razorpay?: unknown }).Razorpay;
  if (existing) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Unable to load Razorpay Checkout"));
    document.head.appendChild(script);
  });
}
function OrderDrawer({
  order,
  close,
  reload,
  customerActions = false,
  notify,
}: {
  order: Order;
  close: () => void;
  reload: () => void;
  customerActions?: boolean;
  notify?: (message: string) => void;
}) {
  const [selfService, setSelfService] = useState(false);
  const [selfServiceError, setSelfServiceError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [actionBusy, setActionBusy] = useState<"cancel" | "reschedule" | "payment" | "">("");
  const [paymentError, setPaymentError] = useState("");
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{order.trackingCode}</span>
            <h2>{order.customerName}</h2>
          </div>
          <button
            className="icon-btn"
            aria-label="Close delivery details"
            onClick={close}
          >
            <X />
          </button>
        </div>
        <div className="route-line">
          <span>A</span>
          <div>
            <small>Pickup</small>
            <strong>{order.pickup.label}</strong>
          </div>
          <i />
          <span>B</span>
          <div>
            <small>Drop-off</small>
            <strong>{order.dropoff.label}</strong>
          </div>
        </div>
        <div className="drawer-stats">
          <div>
            <small>Status</small>
            <Status value={order.status} />
          </div>
          <div>
            <small>Payment</small>
            <Status value={order.paymentStatus} />
          </div>
          <div>
            <small>Amount</small>
            <strong>{money(order.amount)}</strong>
          </div>
          <div>
            <small>Weight</small>
            <strong>{order.packageWeightKg} kg</strong>
          </div>
          <div>
            <small>Estimated arrival</small>
            <strong className={order.lateRisk ? "late-text" : ""}>
              {order.estimatedArrivalAt
                ? new Date(order.estimatedArrivalAt).toLocaleString()
                : "Awaiting route"}
            </strong>
          </div>
          <div>
            <small>Delivery window</small>
            <strong>
              {order.deliveryWindowStart
                ? `${new Date(order.deliveryWindowStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${new Date(order.promisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : `By ${new Date(order.promisedAt).toLocaleString()}`}
            </strong>
          </div>
        </div>
        {order.deliveryNotes && (
          <div className="delivery-notes">
            <small>Delivery instructions</small>
            <p>{order.deliveryNotes}</p>
          </div>
        )}
        <button
          className="button ghost full"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${window.location.origin}/track/${order.trackingCode}`,
              );
              setCopyMessage("Public tracking link copied");
              notify?.("Public tracking link copied");
            } catch {
              setCopyMessage(
                "Clipboard unavailable. Open the tracking link below to share it.",
              );
            }
          }}
        >
          Copy public tracking link
        </button>
        {copyMessage && (
          <p role="status">
            {copyMessage}{" "}
            <a
              href={`/track/${order.trackingCode}`}
              target="_blank"
              rel="noreferrer"
            >
              Open tracking
            </a>
          </p>
        )}
        {customerActions &&
          ["pending", "assigned", "in_transit"].includes(order.status) && (
            <div className="self-service-actions">
              <button
                className="button ghost"
                disabled={Boolean(actionBusy)}
                onClick={() => setSelfService((value) => !value)}
              >
                Reschedule
              </button>
              {["pending", "assigned"].includes(order.status) && (
                <button
                  className="button danger"
                  disabled={Boolean(actionBusy)}
                  onClick={async () => {
                    if (!window.confirm("Cancel this delivery?")) return;
                    setActionBusy("cancel");
                    setSelfServiceError("");
                    try {
                      await api.cancelOrder(order.id);
                      await reload();
                    } catch (reason) {
                      setSelfServiceError(
                        reason instanceof Error
                          ? reason.message
                          : "Unable to cancel delivery",
                      );
                    } finally {
                      setActionBusy("");
                    }
                  }}
                >
                  {actionBusy === "cancel" ? "Cancelling…" : "Cancel delivery"}
                </button>
              )}
            </div>
          )}
        {customerActions && selfService && (
          <form
            className="self-service-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setActionBusy("reschedule");
              setSelfServiceError("");
              try {
                await api.rescheduleOrder(order.id, {
                  deliveryWindowStart: new Date(
                    String(form.get("start")),
                  ).toISOString(),
                  promisedAt: new Date(String(form.get("end"))).toISOString(),
                  deliveryNotes: String(form.get("notes") || "") || undefined,
                });
                await reload();
              } catch (reason) {
                setSelfServiceError(
                  reason instanceof Error
                    ? reason.message
                    : "Unable to reschedule delivery",
                );
              } finally {
                setActionBusy("");
              }
            }}
          >
            <label>
              Window start
              <input
                type="datetime-local"
                name="start"
                required
                defaultValue={order.deliveryWindowStart?.slice(0, 16)}
              />
            </label>
            <label>
              Window end
              <input
                type="datetime-local"
                name="end"
                required
                defaultValue={order.promisedAt.slice(0, 16)}
              />
            </label>
            <label>
              Instructions
              <textarea
                name="notes"
                rows={2}
                defaultValue={order.deliveryNotes || ""}
              />
            </label>
            <button className="button primary" disabled={Boolean(actionBusy)}>
              {actionBusy === "reschedule" ? "Saving…" : "Save new window"}
            </button>
            {selfServiceError && <p className="error">{selfServiceError}</p>}
          </form>
        )}
        {order.paymentStatus !== "paid" && (
          <button
            className="button primary full"
            disabled={Boolean(actionBusy)}
            onClick={async () => {
              setActionBusy("payment");
              setPaymentError("");
              try {
                const checkout = await api.checkout(order.id);
                if (checkout.provider === "demo") {
                  await api.confirmPayment(order.id);
                  await reload();
                  setActionBusy("");
                  return;
                }
                await loadRazorpay();
                const RazorpayCtor = (
                  window as unknown as {
                    Razorpay?: new (options: unknown) => { open: () => void };
                  }
                ).Razorpay;
                if (!RazorpayCtor)
                  throw new Error("Razorpay checkout script is unavailable");
                new RazorpayCtor({
                  key: checkout.keyId,
                  amount: checkout.amount,
                  currency: checkout.currency,
                  name: "RoutePulse",
                  description: `Delivery ${order.trackingCode}`,
                  order_id: checkout.razorpayOrderId,
                  ondismiss: () => setActionBusy(""),
                  handler: async (response: {
                    razorpay_order_id: string;
                    razorpay_payment_id: string;
                    razorpay_signature: string;
                  }) => {
                    try {
                      await api.verify(order.id, {
                        razorpayOrderId: response.razorpay_order_id,
                        razorpayPaymentId: response.razorpay_payment_id,
                        razorpaySignature: response.razorpay_signature,
                      });
                      await reload();
                    } catch (reason) {
                      setPaymentError(
                        reason instanceof Error
                          ? reason.message
                          : "Payment verification failed",
                      );
                    } finally {
                      setActionBusy("");
                    }
                  },
                }).open();
              } catch (reason) {
                setPaymentError(
                  reason instanceof Error
                    ? reason.message
                    : "Unable to start payment",
                );
                setActionBusy("");
              }
            }}
          >
            {actionBusy === "payment"
              ? "Opening secure checkout…"
              : "Pay securely"}
          </button>
        )}
        {paymentError && <p className="error" role="alert">{paymentError}</p>}
        <h3>Timeline</h3>
        <ol className="timeline">
          {[...order.events].reverse().map((e) => (
            <li key={e.id}>
              <i />
              <div>
                <strong>{e.message}</strong>
                <small>{new Date(e.createdAt).toLocaleString()}</small>
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
function CustomerView({
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
  const [selected, setSelected] = useState<Order | null>(null);
  const [support, setSupport] = useState(false);
  if (support)
    return (
      <main className="driver-app">
        <SupportPage
          orders={orders}
          customerOnly
          onBack={() => setSupport(false)}
        />
      </main>
    );
  return (
    <main className="driver-app">
      <header>
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="RoutePulse" />
        </div>
        <button className="icon-btn" aria-label="Sign out" onClick={logout}>
          <LogOut />
        </button>
      </header>
      <section className="driver-greeting">
        <span className="eyebrow">Customer workspace</span>
        <h1>Your deliveries, {user.name.split(" ")[0]}</h1>
        <p>
          Track progress, review the delivery timeline, and complete payment
          securely.
        </p>
      </section>
      <button className="button ghost" onClick={() => setSupport(true)}>
        <LifeBuoy /> Contact support
      </button>
      {orders.length ? (
        <section className="panel table-panel">
          <div className="delivery-list">
            {orders.map((order) => (
              <button key={order.id} onClick={() => setSelected(order)}>
                <span className={`priority ${order.priority}`}>
                  {order.priority === "urgent"
                    ? "!"
                    : order.priority[0].toUpperCase()}
                </span>
                <span>
                  <strong>{order.trackingCode}</strong>
                  <small>
                    {order.dropoff.label} · {money(order.amount)}
                  </small>
                </span>
                <Status value={order.status} />
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="empty">
          <Box />
          <h2>No deliveries yet</h2>
          <p>Orders linked to {user.email} will appear here.</p>
        </section>
      )}
      {selected && (
        <OrderDrawer
          order={selected}
          close={() => setSelected(null)}
          customerActions
          reload={async () => {
            await reload();
            setSelected(null);
          }}
        />
      )}
    </main>
  );
}
function DriverView({
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
    (o) => !["delivered", "failed", "cancelled"].includes(o.status),
  );
  const [sharing, setSharing] = useState(false);
  const [locationError, setLocationError] = useState("");
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
  const ns = active ? next[active.status] : undefined;
  return (
    <main className="driver-app">
      <header>
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="RoutePulse" />
        </div>
        <button className="icon-btn" aria-label="Sign out" onClick={logout}>
          <LogOut />
        </button>
      </header>
      <section className="driver-greeting">
        <span className="eyebrow">Driver workspace</span>
        <h1>Ready to move, {user.name.split(" ")[0]}?</h1>
        <button
          className={`share ${sharing ? "on" : ""}`}
          onClick={() => setSharing(!sharing)}
        >
          <Radio />
          {sharing ? "Location sharing on" : "Start location sharing"}
        </button>
        {locationError && <p className="inline-notice warning">{locationError}</p>}
      </section>
      {active ? (
        <>
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
            {ns && (
              <button
                className="button primary full"
                onClick={async () => {
                  await api.status(active.id, ns);
                  reload();
                }}
              >
                {ns === "picked_up"
                  ? "Confirm pickup"
                  : ns === "in_transit"
                    ? "Start delivery"
                    : "Mark delivered"}{" "}
                <ChevronRight />
              </button>
            )}
          </section>
        </>
      ) : (
        <section className="empty">
          <PackageCheck />
          <h2>You're all caught up</h2>
          <p>New assignments will appear here automatically.</p>
        </section>
      )}
    </main>
  );
}
