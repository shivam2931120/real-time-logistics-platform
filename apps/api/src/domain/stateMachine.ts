import type { OrderStatus } from '@routepulse/shared';

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['assigned', 'cancelled'],
  assigned: ['picked_up', 'cancelled', 'failed'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [], failed: [], cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) { return transitions[from].includes(to); }
export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw Object.assign(new Error(`Cannot move order from ${from} to ${to}`), { status: 409 });
}
