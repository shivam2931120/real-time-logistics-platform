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
  ParcelScan,
  ParcelScanStage,
  Role,
  SupportMessage,
  SupportTicket,
  TrackingSnapshot,
  User,
} from "@routepulse/shared";
const base = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000";
const REQUEST_TIMEOUT_MS = 20_000;
let token = localStorage.getItem("routepulse_token") || "";
let demoSession = localStorage.getItem("routepulse_demo_session") === "1";
type TokenProvider = (options?: { skipCache?: boolean }) => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
export const setToken = (value: string) => {
  token = value;
  if (value) localStorage.setItem("routepulse_token", value);
  else localStorage.removeItem("routepulse_token");
};
export const setDemoSession = (value: boolean) => {
  demoSession = value;
  if (value) localStorage.setItem("routepulse_demo_session", "1");
  else localStorage.removeItem("routepulse_demo_session");
  window.dispatchEvent(new Event("routepulse-demo-session"));
};
export const isDemoSession = () => demoSession;
export const setTokenProvider = (provider: TokenProvider | null) => {
  tokenProvider = provider;
};
async function request<T>(path: string, options: RequestInit = {}, canRefresh = true): Promise<T> {
  if (tokenProvider) {
    try {
      setToken((await tokenProvider()) || "");
    } catch {
      setToken("");
    }
  }
  const controller = new AbortController();
  const externalSignal = options.signal;
  const relayAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted)
      throw new ApiError("The API request timed out. Please retry.", 408);
    throw error;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", relayAbort);
  }
  let body: { error?: string } | T;
  try {
    body = (await res.json()) as { error?: string } | T;
  } catch {
    throw new ApiError(
      res.ok ? "The server returned an invalid response" : "Request failed",
      res.status,
    );
  }
  if (res.status === 401 && canRefresh && tokenProvider) {
    try {
      const refreshed = await tokenProvider({ skipCache: true });
      setToken(refreshed || "");
      if (refreshed) return request<T>(path, options, false);
    } catch {
      setToken("");
    }
  }
  if (!res.ok)
    throw new ApiError(
      (body as { error?: string }).error || "Request failed",
      res.status,
    );
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
export type MapRoute = {
  geometry: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
};
export type MapSearchResult = {
  id: string;
  label: string;
  category: string;
  lat: number;
  lng: number;
};
export const api = {
  base,
  token: () => token,
  socketAuth: (callback: (data: object) => void) => {
    void (async () => {
      if (tokenProvider) {
        try {
          setToken((await tokenProvider()) || "");
        } catch {
          setToken("");
        }
      }
      callback({ token });
    })();
  },
  login: async (role: Role) => {
    const data = await request<{ token: string; user: User }>(
      "/api/auth/demo",
      { method: "POST", body: JSON.stringify({ role }) },
    );
    setToken(data.token);
    return data.user;
  },
  demoLogin: async (email: string, password: string) => {
    const data = await request<{ token: string; user: User }>(
      "/api/auth/demo",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    setDemoSession(true);
    setToken(data.token);
    return data.user;
  },
  logout: () => {
    setDemoSession(false);
    setToken("");
  },
  me: () => request<User>("/api/me"),
  orders: () => request<Order[]>("/api/orders"),
  drivers: () => request<Driver[]>("/api/drivers"),
  driverLocations: (id: string, limit = 100) =>
    request<Array<{ lat: number; lng: number; accuracy?: number; source: string; recordedAt: string }>>(
      `/api/drivers/${encodeURIComponent(id)}/locations?limit=${limit}`,
    ),
  analytics: (days = 7) =>
    request<AnalyticsSummary>(`/api/analytics/summary?days=${days}`),
  mapRoute: (
    points: Array<{ lat: number; lng: number }>,
    signal?: AbortSignal,
  ) =>
    request<MapRoute>("/api/maps/route", {
      method: "POST",
      body: JSON.stringify({ points }),
      signal,
    }),
  mapSearch: (query: string) =>
    request<MapSearchResult[]>(
      `/api/maps/search?query=${encodeURIComponent(query)}`,
    ),
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
    data: {
      status?: DriverStatus;
      capacityKg?: number;
      shiftStart?: string;
      shiftEnd?: string;
      vehiclePlate?: string;
      maintenanceDueAt?: string | null;
      maintenanceStatus?: "ok" | "due" | "overdue";
    },
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
  rescheduleOrder: (
    id: string,
    data: {
      deliveryWindowStart: string;
      promisedAt: string;
      deliveryNotes?: string;
    },
  ) =>
    request<Order>(`/api/customer/orders/${id}/reschedule`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  cancelOrder: (id: string) =>
    request<Order>(`/api/customer/orders/${id}/cancel`, {
      method: "POST",
      body: "{}",
    }),
  scans: (id: string) => request<ParcelScan[]>(`/api/orders/${id}/scans`),
  scan: (id: string, data: { parcelCode: string; stage: ParcelScanStage }) =>
    request<ParcelScan>(`/api/orders/${id}/scans`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  supportTickets: () => request<SupportTicket[]>("/api/support/tickets"),
  createSupportTicket: (data: {
    subject: string;
    category: SupportTicket["category"];
    priority: SupportTicket["priority"];
    orderId?: string;
    message: string;
  }) =>
    request<SupportTicket>("/api/support/tickets", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  supportMessages: (id: string) =>
    request<SupportMessage[]>(`/api/support/tickets/${id}/messages`),
  sendSupportMessage: (id: string, message: string, internal = false) =>
    request<SupportMessage>(`/api/support/tickets/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message, internal }),
    }),
  updateSupportTicket: (
    id: string,
    data: { status?: SupportTicket["status"]; assignedTo?: string | null },
  ) =>
    request<SupportTicket>(`/api/support/tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  downloadReport: async (path: string, filename: string) => {
    const response = await fetch(`${base}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      let message = "Unable to download report";
      try {
        const body = (await response.json()) as { error?: string };
        message = body.error || message;
      } catch {
        // The server may return a non-JSON error body.
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};
