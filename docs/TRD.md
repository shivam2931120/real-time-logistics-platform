# RoutePulse — Technical Requirements Document

## 1. Architecture

RoutePulse is a TypeScript monorepo with a React/Vite web client, Express API, Socket.IO gateway, shared contracts, a PostgreSQL persistence boundary with a memory fallback, optimization service, notification/payment adapters, and an optional BullMQ worker. The checked-in local stack runs PostgreSQL and Redis through Docker; provider adapters remain explicitly configurable.

```text
React Web ──HTTP/JWT──> Express API ──> Repository (PostgreSQL / memory fallback)
    │                       │   │
    └──Socket.IO────────────┘   ├──> Payment adapter (demo / Stripe)
                               ├──> Notification adapter (console / SMTP-SMS)
                               └──> BullMQ ──> Redis ──> Worker
Driver geolocation ──Socket.IO──> validated location store + tenant/tracking rooms
```

## 2. Runtime components

- `apps/web`: role-aware SPA, control tower, orders, live map, analytics, mobile driver surface.
- `apps/api`: REST API, JWT/RBAC, validation, domain state machine, Socket.IO events, adapters.
- `packages/shared`: request/response and domain types shared at compile time.
- PostgreSQL: durable source of truth for the implemented demo tenant; broader Clerk organization mapping remains a deployment task.
- Redis: BullMQ jobs, retry state, horizontal Socket.IO adapter target, distributed rate-limit target.

## 3. Domain model

| Entity | Important fields |
|---|---|
| Organization | id, name, timezone |
| User | id, organizationId, name, email, role |
| Driver | id, userId, status, capacityKg, currentLat/Lng, lastSeenAt |
| Order | id, organizationId, trackingCode, customer, stops, status, priority, amount, paymentStatus, assignedDriverId, timestamps |
| Route | id, driverId, date, orderedStops, distanceKm, durationMin, status |
| OrderEvent | id, orderId, type, actorId, payload, createdAt |
| Notification | id, orderId, channel, recipient, template, status, attempts |
| Payment | id, orderId, provider, providerRef, amount, currency, status |
| AuditEvent | tenant, actor, action, resourceType/id, metadata, createdAt |

Production indexes: `(organization_id,status,created_at)`, `(assigned_driver_id,status)`, unique `tracking_code`, unique `(provider,provider_ref)`, and `(order_id,created_at)` for events.

## 4. API contract

All private endpoints require `Authorization: Bearer <JWT>`. Demo login accepts a role and returns a seeded identity. Mutations support `Idempotency-Key` where replay could duplicate work.

| Method | Route | Roles | Purpose |
|---|---|---|---|
| POST | `/api/auth/demo` | public | issue demo JWT |
| GET | `/api/me` | all | current identity |
| GET/POST | `/api/orders` | ops / dispatcher+ | list or create orders |
| GET | `/api/orders/:id` | authorized | order and timeline |
| PATCH | `/api/orders/:id/status` | driver/dispatcher/admin | validated transition |
| POST | `/api/orders/:id/assign` | dispatcher/admin | manual or nearest-driver assignment |
| POST | `/api/routes/optimize` | dispatcher/admin | capacity-aware stop ordering |
| GET | `/api/drivers` | dispatcher/admin | tenant fleet state |
| POST | `/api/payments/:orderId/checkout` | dispatcher/admin/customer target | Razorpay order or demo session |
| POST | `/api/payments/demo/:orderId/confirm` | demo only | simulate settlement |
| GET | `/api/analytics/summary` | dispatcher/admin | KPIs and trends |
| GET | `/api/track/:code` | public | privacy-minimized tracking snapshot |
| GET | `/health` | public | liveness and adapter modes |

Socket client events: `location:update`, `order:subscribe`. Server events: `driver:location`, `order:updated`, `notification:updated`. Tenant room membership is derived from authenticated claims, never supplied tenant IDs.

## 5. State and consistency

- The API owns lifecycle validation; clients cannot set arbitrary order states.
- Assignment and driver availability must commit atomically in a durable repository.
- Payment callbacks are idempotent on provider event/reference.
- Location is high-volume ephemeral state; latest point is cached while material order events are durable.
- The database is authoritative; queue insertion follows durable job/outbox creation in the production repository.

## 6. Optimization

Input is a depot/current position, candidate stops with coordinates/demand, vehicle capacity, and service minutes. The MVP rejects stops exceeding capacity, builds a nearest-neighbor route using Haversine distance, improves it using bounded 2-opt swaps, and estimates duration at a configurable urban average speed. It is deterministic and explainable, but does not use live traffic, delivery-window constraints, or global VRP optimization.

## 7. Security and privacy

- Zod validates bodies/params; JWT issuer/audience/expiry verified; explicit role guard and tenant filtering.
- `helmet`, CORS allowlist, body limits, API rate limit, coordinate/update throttles.
- Public tracking returns first name, approximate/current delivery location, ETA/status, and masked destination—not phone/email/payment detail.
- Raw location history retention target: 30 days; audit/payment records: 7 years subject to jurisdiction; configurable deletion/export workflows are required before production.
- TLS, managed secret storage, encrypted managed databases, backups, and dependency scanning are deployment requirements.

## 8. Reliability and scaling

- API instances are stateless except demo mode; use Redis Socket.IO adapter for multi-instance fan-out.
- BullMQ workers scale independently with retry/backoff and dead-letter observability.
- Graceful shutdown stops accepting traffic, drains HTTP, closes sockets/queues.
- SLO targets: API 99.9%, p95 read <300 ms, p95 write <600 ms, tracking propagation <3 seconds.

## 9. Testing strategy

- Unit: state machine, Haversine/optimizer, privacy masking.
- API integration: authentication/RBAC, order creation/assignment/status/payment/analytics, validation.
- Web: component and critical flow tests with mocked API.
- E2E target: Playwright dispatcher/driver/customer workflow against containers.
- Load target: WebSocket location fan-out and 50-stop optimizer benchmark.

## 10. Deployment topology

Use a container platform supporting long-lived WebSockets for API/workers and a CDN/static host for the SPA. Provision managed PostgreSQL and Redis; run schema migrations as a release job; deploy API/worker before web; then smoke-test health, auth, creation, Socket.IO, queue, and provider webhook. Vercel serverless alone is not the intended Socket.IO host.

## 11. Configuration modes

Health output reports active persistence, queue, payment, and notification modes. Memory/demo payment modes must never be described as durable, distributed, or financially settled. Production readiness requires managed infrastructure and provider adapters, strong secrets, webhook configuration, Clerk tenant mapping, and security/load/recovery tests.
