# RoutePulse — Product Requirements Document

**Status:** Implemented release baseline
**Product:** Multi-tenant real-time last-mile logistics control tower
**Primary users:** dispatchers, drivers, customers, operations admins

## 1. Product vision

RoutePulse lets a logistics operator accept delivery orders, assign and optimize routes, observe drivers in real time, collect payment, notify customers, and measure delivery performance from one operational workspace. The initial release targets city-scale fleets of 5–500 drivers and emphasizes reliable dispatch decisions rather than freight brokerage or warehouse management.

## 2. Problem

Small and mid-sized delivery teams often coordinate jobs through spreadsheets, calls, consumer maps, and separate payment tools. Dispatch lacks a live source of truth; drivers receive stale sequences; customers cannot predict arrival; and managers cannot explain late or expensive deliveries.

## 3. Goals and success metrics

- Create and dispatch an order in under 60 seconds at p95.
- Show accepted driver locations to authorized viewers within 3 seconds at p95.
- Generate a feasible route for up to 50 stops in under 2 seconds at p95.
- Reach at least 95% successful notification-job execution, excluding provider rejection.
- Track on-time rate, completion time, active fleet, distance, revenue, and failed jobs.
- Keep all tenant data and role capabilities isolated and auditable.

## 4. Personas and roles

| Role       | Jobs to be done                                                   | Main permissions                    |
| ---------- | ----------------------------------------------------------------- | ----------------------------------- |
| Admin      | configure organization, pricing and team; inspect audit/analytics | all tenant resources                |
| Dispatcher | create orders, plan routes, assign drivers, monitor exceptions    | orders, routes, fleet, analytics    |
| Driver     | view assigned route, share location, update delivery status/proof | own assignments only                |
| Customer   | track own delivery and pay outstanding balance                    | own public tracking/payment session |

## 5. MVP functional requirements

### Authentication and tenancy

- Demo identities for every role; signed JWT sessions; role and tenant enforcement at API boundaries.
- Production seam for OIDC/SSO; password storage is deliberately outside MVP.
- Audit actor, action, resource, tenant, timestamp, and contextual metadata.

### Order lifecycle

- Create delivery with customer, pickup/drop-off, coordinates, service priority, package details, price, instructions, recipient PIN, and start/end window.
- State machine: `pending → assigned → picked_up → in_transit → delivered`; `pending|assigned → cancelled`; operational failures may enter `failed`.
- Search/filter order list and show a chronological event timeline.

### Dispatch and route optimization

- Assign an available driver manually or choose the best available driver based on current distance and capacity.
- Optimize stop sequence using nearest-neighbor followed by 2-opt improvement.
- Surface total distance, estimated duration, utilization, and infeasible capacity constraints.
- Re-optimize remaining stops when operations change; never reorder completed stops.

### Live tracking

- Driver browser publishes consented GPS updates.
- Server validates coordinate range, assignment, timestamp, and per-client update rate.
- WebSocket rooms isolate tenant operations and individual tracking codes.
- Dispatcher map updates vehicle markers and order status without refresh.
- A privacy-minimized public tracking URL exposes live location, ETA, window, timeline, and proof-completion summary without an account.

### Driver workflow and proof

- Drivers accept or reject assignments, open navigation, share location, advance valid states, and report operational exceptions.
- Completion requires the recipient PIN, recipient name, and typed electronic signature; proof metadata is durable and no files are uploaded.
- Entering the configurable drop-off geofence creates one arrival event and pushes it to tenant and public tracking rooms.

### Operations administration

- Dispatchers work a pending-order queue against capacity-eligible drivers and manually assign selected pairings.
- Exception Center supports typed categories, open/resolved filtering, resolution notes, and audit history.
- Admins update roles, organization timezone, ETA speed, geofence radius, and notification enablement.

### Payments

- Create a Razorpay Checkout order when configured.
- Demo provider returns a deterministic local payment session; it never claims real settlement.
- Idempotent webhook/payment confirmation moves `pending` to `paid`; refunds and disputes are post-MVP.

### Notifications and queues

- Queue assignment, status, ETA, and delivery notifications through BullMQ when Redis is available.
- Development inline fallback preserves observable behavior while labeling delivery as simulated.
- Persist notification status (`queued`, `sent`, `failed`) and retry transient provider failures with exponential backoff.

### Analytics

- KPI cards: active drivers, deliveries today, on-time percentage, revenue, average delivery minutes.
- Delivery status distribution and seven-day volume/revenue trend.
- Tenant-scoped aggregation only.

## 6. Core user journeys

1. Dispatcher creates an order; the customer gets a tracking code.
2. Dispatcher requests auto-assignment; eligible nearest driver is selected and notified.
3. Driver accepts, starts location sharing, picks up, and advances delivery state.
4. Dispatcher and customer see status/location events in real time.
5. Customer pays through checkout; verified provider callback records settlement.
6. Driver marks delivered; analytics and notification records update.

## 7. Non-functional requirements

- **Security:** OWASP-oriented validation, Helmet, restrictive CORS, rate limits, tenant/role guards, webhook signature verification, no secrets in client bundles.
- **Reliability:** idempotency keys for mutations, reconnecting sockets, queue retries, graceful shutdown, health/readiness endpoints.
- **Performance:** list pagination, bounded WebSocket fan-out, indexed production schema, aggregated analytics endpoints.
- **Accessibility:** keyboard navigation, visible focus, semantic landmarks, color-independent statuses, WCAG AA contrast target.
- **Responsive design:** usable dispatcher view from 360 px; driver workflow optimized for mobile.
- **Observability:** structured request logs, request IDs, health state, queue/notification status, audit events.

## 8. Out of scope for this release

Proof-of-delivery image storage, native mobile background tracking, traffic-aware commercial routing, multi-depot inventory, driver payroll, refunds/disputes, international tax, carrier marketplace, and qualified legal-signature-provider workflows.

## 9. Release acceptance criteria

- All four roles can enter a seeded demo and see only permitted actions.
- An order can be created, assigned, advanced, tracked over WebSocket, paid in demo mode, and reflected in analytics.
- Invalid lifecycle transitions, cross-tenant access, invalid GPS, and duplicate idempotent requests are rejected.
- `npm run ci` passes and the Docker dependencies report healthy.
- README distinguishes demo adapters from configured production integrations.

## 10. Roadmap

- **Current:** PostgreSQL, Clerk, Razorpay, SMTP/BullMQ adapters, public tracking, delivery windows, proof, geofences, exceptions, notifications, settings, roles, and audit.
- **Next:** traffic-aware routing, driver shifts, native background location, offline sync, multi-depot capacity planning, forecasting, enterprise SSO, and image proof when storage is approved.
