import type {
  AnalyticsSummary,
  AuditRecord,
  DeliveryException,
  Driver,
  DriverStatus,
  ExceptionType,
  NotificationRecord,
  Order,
  OrderStatus,
  OrganizationSettings,
  Role,
  TrackingSnapshot,
  User,
} from "@routepulse/shared";
const base = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000";
let token = localStorage.getItem("routepulse_token") || "";
export const setToken = (value: string) => {
  token = value;
  if (value) localStorage.setItem("routepulse_token", value);
  else localStorage.removeItem("routepulse_token");
};
async function request<T>(path: string, options: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body as T;
}
export type RoutePlan = {
  stops: Array<{
    id: string;
    label: string;
    lat: number;
    lng: number;
    demandKg?: number;
  }>;
  distanceKm: number;
  durationMinutes: number;
  algorithm: string;
};
export const api = {
  base,
  token: () => token,
  login: async (role: Role) => {
    const data = await request<{ token: string; user: User }>(
      "/api/auth/demo",
      { method: "POST", body: JSON.stringify({ role }) },
    );
    setToken(data.token);
    return data.user;
  },
  logout: () => setToken(""),
  me: () => request<User>("/api/me"),
  orders: () => request<Order[]>("/api/orders"),
  drivers: () => request<Driver[]>("/api/drivers"),
  analytics: () => request<AnalyticsSummary>("/api/analytics/summary"),
  assign: (id: string, driverId?: string) =>
    request<Order>(`/api/orders/${id}/assign`, {
      method: "POST",
      body: JSON.stringify(driverId ? { driverId } : {}),
    }),
  status: (id: string, status: OrderStatus) =>
    request<Order>(`/api/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  create: (data: unknown) =>
    request<Order>("/api/orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  optimize: (driverId: string, orderIds: string[]) =>
    request<RoutePlan>("/api/routes/optimize", {
      method: "POST",
      body: JSON.stringify({ driverId, orderIds }),
    }),
  track: (code: string) =>
    request<TrackingSnapshot>(`/api/track/${encodeURIComponent(code)}`),
  accept: (id: string) =>
    request<Order>(`/api/orders/${id}/accept`, { method: "POST", body: "{}" }),
  reject: (id: string, reason: string) =>
    request<Order>(`/api/orders/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  proof: (
    id: string,
    data: {
      recipientName: string;
      recipientPin: string;
      signatureData: string;
    },
  ) =>
    request<Order>(`/api/orders/${id}/proof`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  exceptions: () => request<DeliveryException[]>("/api/exceptions"),
  createException: (
    orderId: string,
    type: ExceptionType,
    description: string,
  ) =>
    request<DeliveryException>(`/api/orders/${orderId}/exceptions`, {
      method: "POST",
      body: JSON.stringify({ type, description }),
    }),
  resolveException: (id: string, resolution: string) =>
    request<DeliveryException>(`/api/exceptions/${id}/resolve`, {
      method: "PATCH",
      body: JSON.stringify({ resolution }),
    }),
  notifications: () => request<NotificationRecord[]>("/api/notifications"),
  readNotification: (id: string) =>
    request<NotificationRecord>(`/api/notifications/${id}/read`, {
      method: "PATCH",
      body: "{}",
    }),
  adminUsers: () => request<User[]>("/api/admin/users"),
  updateRole: (id: string, role: Role) =>
    request<User>(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  audit: () => request<AuditRecord[]>("/api/admin/audit"),
  settings: () => request<OrganizationSettings>("/api/settings"),
  updateSettings: (data: OrganizationSettings) =>
    request<OrganizationSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  updateDriver: (
    id: string,
    data: { status?: DriverStatus; capacityKg?: number },
  ) =>
    request<Driver>(`/api/drivers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  checkout: (id: string) =>
    request<{
      provider: string;
      keyId?: string;
      razorpayOrderId?: string;
      amount?: number;
      currency?: string;
      url?: string;
    }>(`/api/payments/${id}/checkout`, { method: "POST", body: "{}" }),
  verify: (id: string, data: unknown) =>
    request<Order>(`/api/payments/${id}/verify`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  confirmPayment: (id: string) =>
    request<Order>(`/api/payments/demo/${id}/confirm`, {
      method: "POST",
      body: "{}",
    }),
};
