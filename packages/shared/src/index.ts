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
  deliveryNotes?: string;
  parcelCode?: string;
  rescheduleCount?: number;
  cancelledAt?: string;
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
  activeDrivers: number;
  deliveriesToday: number;
  onTimeRate: number;
  revenue: number;
  averageDeliveryMinutes: number;
  statusCounts: Record<OrderStatus, number>;
  trend: Array<{ date: string; deliveries: number; revenue: number }>;
}
