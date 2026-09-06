import { useCallback, useEffect, useState } from "react";
import type {
  AnalyticsSummary,
  Driver,
  Order,
  OrderStatus,
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
  Navigation,
  PackageCheck,
  Plus,
  Radio,
  Route,
  Settings,
  Truck,
  Users,
  X,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { io } from "socket.io-client";
import { api } from "./lib/api";
import { LiveMap } from "./components/LiveMap";
import { CreateOrder } from "./components/CreateOrder";
import { DeliveriesPage } from "./pages/DeliveriesPage";
import { FleetPage } from "./pages/FleetPage";
import { RoutePlannerPage } from "./pages/RoutePlannerPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { DispatchPage } from "./pages/DispatchPage";
import { ExceptionsPage } from "./pages/ExceptionsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { AdminPage } from "./pages/AdminPage";
import { DriverWorkspace } from "./pages/DriverWorkspace";

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
  | "admin";
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
          <span className="brand-mark">
            <Navigation />
          </span>
          <span>RoutePulse</span>
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
          <small>LIVE NETWORK · BENGALURU</small>
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
    [loading, setLoading] = useState(true),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<Order | null>(null),
    [mobile, setMobile] = useState(false),
    [view, setView] = useState<View>(viewFromPath);
  const load = useCallback(async () => {
    if (!api.token()) return setLoading(false);
    try {
      const me = await api.me();
      setUser(me);
      const os = await api.orders();
      setOrders(os);
      if (me.role === "admin" || me.role === "dispatcher") {
        const [ds, a] = await Promise.all([api.drivers(), api.analytics()]);
        setDrivers(ds);
        setAnalytics(a);
      }
    } catch {
      api.logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
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
    if (!user) return;
    const socket = io(api.base, { auth: { token: api.token() } });
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
  }, [user]);
  const navigate = (nextView: View) => {
    const update = () => {
      if (window.location.pathname !== `/${nextView}`)
        window.history.pushState({}, "", `/${nextView}`);
      setView(nextView);
      setMobile(false);
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
      <div className="splash">
        <Navigation /> Loading operations…
      </div>
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
      <DriverWorkspace
        user={user}
        orders={orders}
        reload={load}
        logout={() => {
          api.logout();
          setUser(null);
        }}
      />
    );
  if (user.role === "customer")
    return (
      <CustomerView
        user={user}
        orders={orders}
        reload={load}
        logout={() => {
          api.logout();
          setUser(null);
        }}
      />
    );
  const nav: Array<readonly [View, string, typeof Activity]> = [
    ["overview", "Overview", Activity],
    ["dispatch", "Dispatch board", LayoutDashboard],
    ["deliveries", "Deliveries", PackageCheck],
    ["fleet", "Fleet", Truck],
    ["routes", "Route planner", Route],
    ["exceptions", "Exceptions", AlertTriangle],
    ["notifications", "Notifications", Bell],
    ["analytics", "Analytics", BarChart3],
    ...(user.role === "admin"
      ? [["admin", "Administration", Settings] as const]
      : []),
  ];
  const kpis = [
    ["Fleet online", analytics?.activeDrivers ?? 0, "2 drivers active", Truck],
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
          <span className="brand-mark">
            <Navigation />
          </span>
          <span>RoutePulse</span>
        </div>
        <button className="close-nav" onClick={() => setMobile(false)}>
          <X />
        </button>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              className={view === id ? "active" : ""}
              key={id}
              onClick={() => navigate(id)}
            >
              <Icon />
              <span>{label}</span>
              {id === "deliveries" && (
                <b>
                  {
                    orders.filter(
                      (o) => !["delivered", "cancelled"].includes(o.status),
                    ).length
                  }
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="system">
            <span />
            <div>
              <strong>Network healthy</strong>
              <small>Realtime connected</small>
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
      <div className="workspace">
        <header>
          <button className="mobile-menu" onClick={() => setMobile(true)}>
            <Menu />
          </button>
          <div>
            <span className="eyebrow">
              {new Intl.DateTimeFormat("en-IN", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              }).format(new Date())}
            </span>
            <h2>
              {view === "overview"
                ? `Good morning, ${user.name.split(" ")[0]}`
                : nav.find((n) => n[0] === view)?.[1]}
            </h2>
          </div>
          <div className="header-actions">
            <button
              className="icon-btn"
              onClick={() => navigate("notifications")}
            >
              <Bell />
              <i />
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
          {view === "overview" && (
            <>
              <section className="hero-row">
                <div>
                  <span className="live-pill">
                    <Radio /> LIVE OPERATIONS
                  </span>
                  <h1>Your fleet is moving.</h1>
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
                    <div
                      className="status-dots"
                      aria-label="Operational status"
                    >
                      <i className="success" />
                      <i className="success" />
                      <i className="progress" />
                      <i />
                      <i />
                    </div>
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
                  <LiveMap drivers={drivers} orders={orders} />
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
                            stopColor="#c6f135"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#c6f135"
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
                        stroke="#9fca19"
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
                </article>
              </section>
            </>
          )}
          {view === "dispatch" && (
            <DispatchPage
              orders={orders}
              drivers={drivers}
              assign={async (orderId, driverId) => {
                await api.assign(orderId, driverId);
                await load();
              }}
            />
          )}
          {view === "deliveries" && (
            <DeliveriesPage
              orders={orders}
              drivers={drivers}
              create={() => setCreate(true)}
              select={setSelected}
              assign={async (id) => {
                await api.assign(id);
                await load();
              }}
            />
          )}
          {view === "fleet" && (
            <FleetPage drivers={drivers} orders={orders} reload={load} />
          )}{" "}
          {view === "routes" && (
            <RoutePlannerPage drivers={drivers} orders={orders} />
          )}{" "}
          {view === "exceptions" && <ExceptionsPage orders={orders} />}{" "}
          {view === "notifications" && <NotificationsPage />}{" "}
          {view === "analytics" && <AnalyticsPage analytics={analytics} />}{" "}
          {view === "admin" && user.role === "admin" && <AdminPage />}
        </main>
      </div>
      {create && <CreateOrder close={() => setCreate(false)} saved={load} />}{" "}
      {selected && (
        <OrderDrawer
          order={selected}
          close={() => setSelected(null)}
          reload={async () => {
            await load();
            setSelected(null);
          }}
        />
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
}: {
  order: Order;
  close: () => void;
  reload: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{order.trackingCode}</span>
            <h2>{order.customerName}</h2>
          </div>
          <button className="icon-btn" onClick={close}>
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
          onClick={() =>
            void navigator.clipboard.writeText(
              `${window.location.origin}/track/${order.trackingCode}`,
            )
          }
        >
          Copy public tracking link
        </button>
        {order.paymentStatus !== "paid" && (
          <button
            className="button primary full"
            onClick={async () => {
              const checkout = await api.checkout(order.id);
              if (checkout.provider === "demo") {
                await api.confirmPayment(order.id);
                reload();
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
                handler: async (response: {
                  razorpay_order_id: string;
                  razorpay_payment_id: string;
                  razorpay_signature: string;
                }) => {
                  await api.verify(order.id, {
                    razorpayOrderId: response.razorpay_order_id,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                  });
                  reload();
                },
              }).open();
            }}
          >
            Pay securely
          </button>
        )}
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
  return (
    <main className="driver-app">
      <header>
        <div className="brand">
          <span className="brand-mark">
            <Navigation />
          </span>
          RoutePulse
        </div>
        <button className="icon-btn" onClick={logout}>
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
  useEffect(() => {
    if (!sharing) return;
    const socket = io(api.base, { auth: { token: api.token() } });
    const send = () =>
      navigator.geolocation?.getCurrentPosition((p) =>
        socket.emit("location:update", {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
        }),
      );
    send();
    const id = setInterval(send, 5000);
    return () => {
      clearInterval(id);
      socket.close();
    };
  }, [sharing]);
  const ns = active ? next[active.status] : undefined;
  return (
    <main className="driver-app">
      <header>
        <div className="brand">
          <span className="brand-mark">
            <Navigation />
          </span>
          RoutePulse
        </div>
        <button className="icon-btn" onClick={logout}>
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
