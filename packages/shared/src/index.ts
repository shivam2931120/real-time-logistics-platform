export type Role = 'admin' | 'dispatcher' | 'driver' | 'customer';
export type OrderStatus = 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'cancelled';
export type DriverStatus = 'available' | 'busy' | 'offline';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed';
export interface Coordinate { lat: number; lng: number }
export interface Address extends Coordinate { label: string }
export interface User { id: string; organizationId: string; name: string; email: string; role: Role }
export interface Driver { id: string; userId: string; name: string; status: DriverStatus; capacityKg: number; location: Coordinate; lastSeenAt: string }
export interface OrderEvent { id: string; type: string; message: string; actorId?: string; createdAt: string }
export interface Order { id: string; organizationId: string; trackingCode: string; customerName: string; customerEmail: string; pickup: Address; dropoff: Address; packageWeightKg: number; priority: 'standard' | 'express' | 'urgent'; status: OrderStatus; amount: number; currency: string; paymentStatus: PaymentStatus; assignedDriverId?: string; promisedAt: string; createdAt: string; updatedAt: string; deliveredAt?: string; events: OrderEvent[] }
export interface AnalyticsSummary { activeDrivers: number; deliveriesToday: number; onTimeRate: number; revenue: number; averageDeliveryMinutes: number; statusCounts: Record<OrderStatus, number>; trend: Array<{ date: string; deliveries: number; revenue: number }> }
