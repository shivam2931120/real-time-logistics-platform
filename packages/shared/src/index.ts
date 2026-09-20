export type Role = "admin" | "dispatcher" | "driver" | "customer";
export type OrderStatus =
  | "pending"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "cancelled";
export type DriverStatus = "available" | "busy" | "offline";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed";
export interface Coordinate {
  lat: number;
  lng: number;
}
export interface Address extends Coordinate {
  label: string;
}
export interface CustomerAddressBookEntry {
  id: string;
  organizationId: string;
  userId: string;
  label: string;
  address: Address;
  deliveryNotes?: string;
  contactName?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ServiceTerritory {
  id: string;
  organizationId: string;
  name: string;
  polygon: Coordinate[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: Role;
}
export interface Driver {
  id: string;
  userId: string;
  name: string;
  status: DriverStatus;
  capacityKg: number;
  location: Coordinate;
  lastSeenAt: string;
  shiftStart?: string;
  shiftEnd?: string;
  vehiclePlate?: string;
  maintenanceDueAt?: string;
  maintenanceStatus?: "ok" | "due" | "overdue";
}
export interface RouteOptimizationConstraints {
  /** ISO timestamp used as the start of the route simulation. */
  startAt?: string;
  /** Average road speed used by the deterministic fallback optimizer. */
  averageSpeedKph?: number;
  /** Minutes spent at each delivery stop. */
  serviceMinutes?: number;
  /** Reject plans that finish after this many minutes. */
  maxRouteMinutes?: number;
  /** Penalize and report delivery-window violations. */
  respectTimeWindows?: boolean;
  /** Include the drive back to the driver's starting location. */
  returnToDepot?: boolean;
  /** Driver shift boundary, either HH:mm or an ISO timestamp. */
  shiftEnd?: string;
}
export interface RoutePlanStop extends Address {
  id: string;
  demandKg?: number;
  priority?: Order["priority"];
  deliveryWindowStart?: string;
  promisedAt?: string;
  arrivalAt?: string;
  departureAt?: string;
  waitMinutes?: number;
  lateRisk?: boolean;
}
export interface RoutePlan {
  stops: RoutePlanStop[];
  distanceKm: number;
  durationMinutes: number;
  algorithm: string;
  startAt?: string;
  finishAt?: string;
  returnToDepot?: boolean;
  warnings?: string[];
}
export type RouteRunStatus =
  | "draft"
  | "published"
  | "in_progress"
  | "completed"
  | "cancelled";
export interface RouteRun {
  id: string;
  organizationId: string;
  driverId: string;
  orderIds: string[];
  stops: RoutePlanStop[];
  distanceKm: number;
  durationMinutes: number;
  status: RouteRunStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  completedAt?: string;
}
export interface OrderEvent {
  id: string;
  type: string;
  message: string;
  actorId?: string;
  createdAt: string;
}
export interface DeliveryProof {
  recipientName: string;
  signatureData: string;
  photoData?: string;
  verificationMethod?: "pin" | "qr" | "pin+qr";
  location?: Coordinate;
  createdAt: string;
  driverId: string;
}
export interface Order {
  id: string;
  organizationId: string;
  trackingCode: string;
  customerName: string;
  customerEmail: string;
  pickup: Address;
  dropoff: Address;
  packageWeightKg: number;
  priority: "standard" | "express" | "urgent";
  status: OrderStatus;
  amount: number;
  currency: string;
  paymentStatus: PaymentStatus;
  assignedDriverId?: string;
  deliveryWindowStart?: string;
  promisedAt: string;
  estimatedArrivalAt?: string;
  lateRisk?: boolean;
  etaConfidence?: "high" | "medium" | "low";
  locationAgeSeconds?: number;
  deliveryNotes?: string;
  parcelCode?: string;
  rescheduleCount?: number;
  cancelledAt?: string;
  returnRequestedAt?: string;
  returnReason?: string;
  returnStatus?: "requested" | "approved" | "rejected";
  proof?: DeliveryProof;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  events: OrderEvent[];
}
export type ExceptionType =
  | "delay"
  | "address_issue"
  | "customer_unavailable"
  | "vehicle_issue"
  | "package_issue"
  | "delivery_failed";
export interface DeliveryException {
  id: string;
  organizationId: string;
  orderId: string;
  type: ExceptionType;
  description: string;
  status: "open" | "resolved";
  createdBy: string;
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}
export interface NotificationRecord {
  id: string;
  organizationId: string;
  userId?: string;
  orderId?: string;
  channel: "email" | "in_app";
  title: string;
  message: string;
  status: "queued" | "sent" | "simulated" | "failed";
  readAt?: string;
  createdAt: string;
}
export interface AuditRecord {
  id: string;
  organizationId: string;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface OrganizationSettings {
  organizationId: string;
  name: string;
  timezone: string;
  geofenceRadiusMeters: number;
  averageSpeedKph: number;
  notificationsEnabled: boolean;
}
export interface OrganizationSummary {
  organizationId: string;
  name: string;
  timezone: string;
  clerkOrganizationId?: string;
}
export interface IntegrationApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}
export interface IntegrationWebhookSummary {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface BillingSummary {
  periodStart: string;
  currency: string;
  orderCount: number;
  capturedPayments: number;
  outstandingAmount: number;
  failedPayments: number;
  paymentCollectionRate: number;
  provider: string;
}
export type PaymentReconciliationRowStatus =
  | "matched"
  | "unpaid"
  | "missing_record"
  | "mismatch";
export interface PaymentReconciliationRow {
  orderId: string;
  trackingCode: string;
  customerName: string;
  orderAmount: number;
  currency: string;
  orderPaymentStatus: PaymentStatus;
  provider?: string;
  providerRef?: string;
  providerStatus?: string;
  providerAmount?: number;
  providerCurrency?: string;
  status: PaymentReconciliationRowStatus;
  createdAt: string;
  paymentCreatedAt?: string;
}
export interface PaymentReconciliationSummary {
  periodStart: string;
  periodEnd: string;
  windowDays: number;
  currency: string;
  provider: string;
  orderCount: number;
  capturedCount: number;
  capturedAmount: number;
  outstandingCount: number;
  outstandingAmount: number;
  failedCount: number;
  failedAmount: number;
  missingRecordCount: number;
  mismatchCount: number;
  rows: PaymentReconciliationRow[];
}
export type SettlementMatchStatus =
  | "matched"
  | "missing_order"
  | "amount_mismatch"
  | "currency_mismatch"
  | "refund"
  | "chargeback";
export type SettlementReviewStatus = "pending" | "accepted" | "rejected";
export interface PaymentSettlementRow {
  id: string;
  organizationId: string;
  provider: string;
  providerRef: string;
  orderId?: string;
  trackingCode?: string;
  orderAmount?: number;
  providerAmount: number;
  feeAmount?: number;
  netAmount?: number;
  currency: string;
  providerStatus: string;
  matchStatus: SettlementMatchStatus;
  reviewStatus: SettlementReviewStatus;
  note?: string;
  settledAt?: string;
  importedAt: string;
}
export interface PaymentSettlementSummary {
  provider: string;
  importedAt?: string;
  rowCount: number;
  matchedCount: number;
  reviewCount: number;
  missingOrderCount: number;
  mismatchCount: number;
  refundCount: number;
  rows: PaymentSettlementRow[];
}
export type OperationalAlertType = "route_deviation" | "excessive_dwell" | "stale_gps";
export type OperationalAlertSeverity = "warning" | "critical";
export interface OperationalAlert {
  id: string;
  organizationId: string;
  type: OperationalAlertType;
  severity: OperationalAlertSeverity;
  title: string;
  description: string;
  driverId?: string;
  orderId?: string;
  routeRunId?: string;
  threshold: number;
  value: number;
  unit: "km" | "minutes";
  createdAt: string;
}
export type SlaTaskStatus = "open" | "acknowledged" | "resolved";
export type SlaTaskType = "late_delivery" | "operational_alert" | "exception" | "support_ticket" | "maintenance";
export interface SlaTask {
  id: string;
  organizationId: string;
  type: SlaTaskType;
  title: string;
  description: string;
  severity: OperationalAlertSeverity;
  dueAt: string;
  status: SlaTaskStatus;
  orderId?: string;
  driverId?: string;
  ticketId?: string;
  assigneeId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface TrackingSnapshot {
  trackingCode: string;
  customerName: string;
  status: OrderStatus;
  priority: Order["priority"];
  destination: string;
  pickup: Address;
  dropoff: Address;
  driver: { name: string; location: Coordinate; lastSeenAt: string } | null;
  deliveryWindowStart?: string;
  promisedAt: string;
  estimatedArrivalAt?: string;
  lateRisk: boolean;
  etaConfidence?: "high" | "medium" | "low";
  locationAgeSeconds?: number;
  updatedAt: string;
  proof?: { recipientName: string; createdAt: string };
  events: Array<Pick<OrderEvent, "type" | "message" | "createdAt">>;
}
export type ParcelScanStage = "pickup" | "hub" | "delivery";
export interface ParcelScan {
  id: string;
  organizationId: string;
  orderId: string;
  parcelCode: string;
  stage: ParcelScanStage;
  scannedBy: string;
  scannedAt: string;
}
export type SupportTicketStatus = "open" | "pending" | "resolved";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";
export type SupportTicketCategory =
  "delivery" | "payment" | "address" | "account" | "other";
export interface SupportTicket {
  id: string;
  organizationId: string;
  orderId?: string;
  customerId?: string;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  createdBy: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
}
export interface SupportMessage {
  id: string;
  ticketId: string;
  organizationId: string;
  senderId: string;
  senderName?: string;
  senderRole: Role;
  message: string;
  internal: boolean;
  createdAt: string;
}
export interface AnalyticsSummary {
  windowDays: number;
  totalOrders: number;
  activeDrivers: number;
  deliveriesToday: number;
  onTimeRate: number;
  completionRate: number;
  paymentCollectionRate: number;
  atRiskDeliveries: number;
  openExceptions: number;
  revenue: number;
  revenuePerDelivery: number;
  averageDeliveryMinutes: number;
  totalRouteKm: number;
  averageRouteKm: number;
  statusCounts: Record<OrderStatus, number>;
  trend: Array<{ date: string; deliveries: number; revenue: number }>;
  geofence: {
    arrivals: number;
    departures: number;
    currentlyInside: number;
    averageDwellMinutes: number;
  };
  priorityPerformance: Array<{
    priority: Order["priority"];
    orders: number;
    delivered: number;
    onTimeRate: number;
    averageDeliveryMinutes: number;
  }>;
  driverPerformance: Array<{
    driverId: string;
    driverName: string;
    assigned: number;
    completed: number;
    onTimeRate: number;
    activeLoadKg: number;
  }>;
  zonePerformance: Array<{
    zone: string;
    orders: number;
    delivered: number;
    onTimeRate: number;
    revenue: number;
  }>;
  comparison?: {
    previousWindowDays: number;
    ordersDeltaPct: number;
    revenueDeltaPct: number;
    onTimeRateDelta: number;
    completionRateDelta: number;
  };
}
export interface ForecastPoint {
  date: string;
  predictedOrders: number;
  lowerBound: number;
  upperBound: number;
  predictedRevenue: number;
  recommendedDrivers: number;
  capacityAlert: boolean;
}
export interface ForecastSummary {
  generatedAt: string;
  horizonDays: number;
  baselineWindowDays: number;
  historicalAveragePerDay: number;
  predictedOrders: number;
  predictedRevenue: number;
  capacityPerDay: number;
  confidence: "low" | "medium" | "high";
  points: ForecastPoint[];
  alerts: Array<{ date: string; message: string; severity: "info" | "warning" }>;
}
