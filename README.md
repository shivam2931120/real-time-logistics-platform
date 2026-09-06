# RoutePulse

A complete, runnable real-time last-mile logistics control tower with dispatcher, driver, administrator, and customer roles.

## Included

- Live MapLibre fleet map and driver browser geolocation
- Public no-login tracking with live position, ETA, delivery window, and timeline
- Manual dispatch, capacity-aware assignment, late-risk ETAs, and geofence arrivals
- Exception workflows and a mobile driver workspace with accept/reject/navigation actions
- PIN-verified proof of delivery with a typed electronic signature (no uploads)
- Notification history, team roles, organization settings, and audit history
- Authenticated Socket.IO rooms for tenant/order updates
- Order state machine, nearest-driver assignment, Haversine + 2-opt route optimization
- BullMQ/Redis notification queue with safe simulated fallback
- Razorpay Checkout adapter, server-side verification, and signed webhook route
- KPI analytics and seven-day trends
- Customer self-service rescheduling/cancellation with notifications and audit history
- Chain-of-custody parcel scanning (pickup, hub, delivery) with manual and camera-ready workflows
- CSV exports for delivery detail and operational summary reports
- Support and communication center with ticket priorities, status workflow, internal-safe messaging, and live updates
- Fleet operating controls for shift windows, vehicle plates, capacity, and maintenance status
- Responsive dispatcher control tower and mobile driver workflow
- Role/tenant guards, validation, rate limits, structured logging, tests
- Production relational schema and local PostgreSQL/Redis containers

Read [PRD](docs/PRD.md) and [TRD](docs/TRD.md) for the product and architecture decisions.

## Run the interactive demo

Requirements: Node.js 22+.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Choose a role on the demo login screen. The API is at `http://localhost:4000`; `GET /health` reports which adapters are active.

With a local `apps/api/.env` and Docker services, orders, drivers, and order events are loaded from PostgreSQL and mutation writes are persisted. Environment files are intentionally ignored by Git. If `DATABASE_URL` is omitted, the API falls back to memory for lightweight UI work. Notification delivery is simulated unless a provider is configured, and demo payment confirmation is not financial settlement.

## Enable infrastructure

```bash
cp apps/api/.env.local.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
docker compose up -d
npm run db:migrate -w @routepulse/api
npm run db:seed -w @routepulse/api
```

Setting `REDIS_URL` enables BullMQ queue insertion. Start the worker separately with:

```bash
npx tsx apps/api/src/workers/notificationWorker.ts
```

The PostgreSQL design and repeatable local migration are in `docs/schema.sql` and `apps/api/src/db/migrate.ts`. Run `npm run db:migrate -w @routepulse/api` and `npm run db:seed -w @routepulse/api` after creating a fresh database.

For provider setup and deployment, read [Provider setup](docs/PROVIDER_SETUP.md). Razorpay checkout and signed webhook routes are implemented; keep API secrets server-side and use Test Mode first.

## Quality checks

```bash
npm run ci
RUN_DB_TESTS=1 npm run test -w @routepulse/api -- --run test/persistence.test.ts
# With the API and infrastructure running:
npm run smoke:runtime -w @routepulse/api
```

The first command runs TypeScript checks, API/web tests, and production builds. The database test proves reload stability; the runtime smoke proves authenticated creation, atomic assignment, WebSocket location updates, the full delivery lifecycle, durable events, and driver release, then removes its test order.

## Demo workflow

1. Enter as Dispatcher and create a delivery.
2. Open Deliveries and select **Auto assign**.
3. Sign out and enter as Driver; advance the active job and optionally share browser geolocation.
4. Return as Dispatcher to see the updated status and analytics.
5. Open an unpaid delivery and complete Razorpay checkout (or demo confirmation when unconfigured).
6. Share `/track/<tracking-code>` with a customer; no login is required.
7. As a customer, open a delivery to reschedule/cancel when eligible, or use **Contact support**. Operations users can export CSV reports, scan parcels, and manage support tickets from the sidebar.

## Honest production boundary

The application has a working PostgreSQL persistence layer and repeatable migrations, plus configurable Clerk, Razorpay, BullMQ, and SMTP adapters. A high-scale launch still requires a Redis Socket.IO adapter for multiple API instances, a transactional outbox, a managed map/routing SLA, monitoring, backups, privacy retention jobs, load testing, and native/background driver tracking. Proof is intentionally text/PIN based; image uploads are out of scope.
