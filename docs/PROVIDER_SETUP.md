# Provider and deployment setup

The source tree contains no provider secrets. Enter backend values in local `apps/api/.env` and frontend values in `apps/web/.env.local` for development. For deployment, use Render/Vercel dashboard environment variables.

The application now has separate liveness/readiness checks, durable driver-location writes, idempotent payment webhooks, customer return requests, and a deployable BullMQ notification worker. Local development can still use the simulated adapters; hosted production should enable the real providers listed below.

| Provider    | Put these variables here                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clerk       | `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, and `AUTH_MODE=clerk` in `apps/api/.env`; `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local` |
| Razorpay    | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in `apps/api/.env`                                                              |
| Google SMTP | `GOOGLE_SMTP_USER`, `GOOGLE_SMTP_APP_PASSWORD`, `EMAIL_FROM` in `apps/api/.env`                                                                     |
| Hosted API  | managed `DATABASE_URL`, managed `REDIS_URL`, `APP_ENV=production`, and deployed `WEB_ORIGIN` in Render                                                |
| Hosted web  | deployed `VITE_API_URL` and optional `VITE_MAP_STYLE` in Vercel                                                                                     |

Do not paste secret values into chat or commit either environment file. Set them directly in the named local file or hosting dashboard.

## Complete environment reference

### Backend: `apps/api/.env`

| Variable                       | When it is needed                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `PORT`                         | Optional; API port, defaults to `4000`                                                                |
| `APP_ENV`                     | `development`, `staging`, or `production`; controls readiness requirements                             |
| `STRICT_CONFIG`               | Set to `true` only after all required production values are present; startup then fails on drift      |
| `WEB_ORIGIN`                   | Required when the frontend is hosted; comma-separated allowed origins                                 |
| `JWT_SECRET`                   | Required for secure demo JWT sessions; use a long random value outside local development              |
| `AUTH_MODE`                    | Set to `demo` for seeded login or `clerk` for Clerk sessions                                          |
| `DEMO_AUTH_ENABLED`            | Keep `true` for the public showcase; set `false` in the real production tenant                       |
| `DEFAULT_ORGANIZATION_ID`      | Clerk fallback tenant; local demo uses `org_demo`                                                     |
| `DATABASE_URL`                 | Required for durable PostgreSQL persistence; without it the API uses memory-demo mode                 |
| `DB_POOL_MAX`                  | Optional PostgreSQL connection cap; defaults to `5` for free poolers                                  |
| `DB_CONNECTION_TIMEOUT_MS`     | Optional database connect timeout; defaults to `15000`                                                |
| `REDIS_URL`                    | Required for BullMQ notification queues and the notification worker when `QUEUE_MODE=bullmq`          |
| `QUEUE_MODE`                   | Use `inline` on a web-only service; use `bullmq` only when a worker is running against the same Redis |
| `MIGRATE_ON_START`             | Set to `true` on Render to run the idempotent PostgreSQL schema migration before loading durable state; keep `false` for local development when migrations are run explicitly |
| `CLERK_SECRET_KEY`             | Required only when `AUTH_MODE=clerk`                                                                  |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Required to accept Clerk webhooks                                                                     |
| `RAZORPAY_KEY_ID`              | Required to enable Razorpay checkout                                                                  |
| `RAZORPAY_KEY_SECRET`          | Required to create and verify Razorpay payments                                                       |
| `RAZORPAY_WEBHOOK_SECRET`      | Required to verify Razorpay webhooks                                                                  |
| `GOOGLE_SMTP_USER`             | Required to send real email instead of simulated notifications                                        |
| `GOOGLE_SMTP_APP_PASSWORD`     | Required with `GOOGLE_SMTP_USER`; use an app password                                                 |
| `EMAIL_FROM`                   | Sender address for real email                                                                         |
| `SMTP_HOST`                    | Optional SMTP override; defaults to `smtp.gmail.com`                                                  |
| `SMTP_PORT`                    | Optional SMTP override; defaults to `465`                                                             |
| `SMTP_SECURE`                  | Optional SMTP TLS override; defaults to `true`                                                        |
| `GLITCHTIP_DSN`                | Optional monitoring DSN; keep empty until a GlitchTip/Sentry-compatible endpoint is configured       |

### Frontend: `apps/web/.env.local`

| Variable                     | When it is needed                                                    |
| ---------------------------- | -------------------------------------------------------------------- |
| `VITE_API_URL`               | API base URL; local default is `http://127.0.0.1:4000`               |
| `VITE_CLERK_PUBLISHABLE_KEY` | Required only for Clerk login; leave blank for role-based demo login |
| `VITE_MAP_STYLE`             | Optional MapLibre style URL                                          |

Razorpay's public checkout key is returned by the authenticated checkout API; no frontend Razorpay secret or `VITE_RAZORPAY_*` variable is needed.

### Test and deployment controls

| Variable          | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| `RUN_DB_TESTS=1`  | Opts into the PostgreSQL integration test                   |
| `API_URL`         | Optional base URL override for `smoke:runtime`              |
| `NODE_VERSION=22` | Render runtime selection, already declared in `render.yaml` |

## Clerk

1. Create a Clerk application and copy the publishable key into Vercel as `VITE_CLERK_PUBLISHABLE_KEY`.
2. Copy the secret key into Render as `CLERK_SECRET_KEY`.
3. Set `AUTH_MODE=clerk`.
4. In Clerk Dashboard → Users, open each user and set public metadata to one RoutePulse role, for example `{ "role": "admin" }`. Valid values are `admin`, `dispatcher`, `driver`, and `customer`. This keeps the four application roles on Clerk's free plan; custom Clerk organization roles are not required.
5. In Clerk Dashboard → Webhooks, add `https://<render-api>/api/webhooks/clerk`; subscribe to `user.created`, `user.updated`, and `user.deleted`, then copy its signing secret into Render as `CLERK_WEBHOOK_SIGNING_SECRET`.

The API accepts Clerk session tokens, while the webhook synchronizes user identity, email, and public-metadata role into PostgreSQL. When a session contains a Clerk `org_id`, the API idempotently provisions or selects the matching `organizations.clerk_organization_id` row and stores the user as a membership in that tenant. Settings, orders, drivers, tickets, notifications, and audits remain filtered by that organization. Sessions without an active Clerk organization use `DEFAULT_ORGANIZATION_ID` (or the showcase `org_demo` fallback).

The production sign-in page includes four public sandbox accounts (admin, dispatcher, driver, and customer) for demonstrations. When `DEMO_AUTH_ENABLED=true`, those accounts use the isolated seeded showcase workspace and do not require Clerk MFA. The preserved owner account is not a sandbox account. The Render migration removes the legacy `@routepulse.demo` users and `RP-DEMO*` records once, preserving the organization and owner account. Set `DEMO_AUTH_ENABLED=false` on a real production tenant; that disables the sandbox and prevents seeded showcase fixtures from loading.

## Razorpay

1. Use Test Mode while developing.
2. Put Key ID in `RAZORPAY_KEY_ID` and Key Secret in `RAZORPAY_KEY_SECRET` on Render only.
3. In Razorpay Dashboard → Account & Settings → Webhooks, add `https://<render-api>/api/webhooks/razorpay`.
4. Create a dedicated webhook secret and set it as `RAZORPAY_WEBHOOK_SECRET`.
5. Enable payment events such as `payment.captured` and `order.paid`.

The API has server-side checkout creation, payment signature verification, and webhook HMAC verification. Browser redirects must not be treated as settlement.

## Google SMTP

Use the Gmail/Workspace address as `GOOGLE_SMTP_USER`. Enable 2-Step Verification, create a Google App Password named `RoutePulse SMTP`, and put that generated value in `GOOGLE_SMTP_APP_PASSWORD`. Set `EMAIL_FROM` to the same address or a configured alias. Never use the normal Google account password.

## Free maps

The application uses MapLibre with the key-free OpenFreeMap Liberty style. Road geometry and address search are validated and proxied through the API, which keeps short-lived in-process OSRM/Nominatim caches, falls back to Photon when Nominatim is unavailable, and returns only normalized geometry/place results. These public upstreams have fair-use/rate limits and must not be treated as an unlimited production SLA; use managed providers and a distributed cache for sustained production traffic.

## Free monitoring

- GlitchTip: closest Sentry-compatible self-hosted option; set `GLITCHTIP_DSN`.
- SigNoz: OpenTelemetry logs, metrics, and traces; suitable for a Docker/VM deployment.
- Uptime Kuma: lightweight uptime checks for the Render API and Vercel web URL.

## Render and Vercel

The checked-in `render.yaml` creates one free web service configured for Clerk authentication and inline notifications. Secret provider values are marked `sync: false` so they remain in Render's dashboard rather than source control. Free Render background workers are not available, so no worker is declared. The service binds its liveness port before database initialization, runs the idempotent migration at startup when `MIGRATE_ON_START=true`, and keeps `/health/ready` truthful while retrying a temporarily unavailable database.

After the web frontend is deployed, set `WEB_ORIGIN` on Render to its exact HTTPS origin and set `VITE_API_URL` on Vercel to the Render API URL. Set `VITE_CLERK_PUBLISHABLE_KEY` and switch the backend to `AUTH_MODE=clerk` only when Clerk is configured. The public sandbox credentials use the dedicated `/api/auth/demo` flow even in Clerk mode; set `DEMO_AUTH_ENABLED=false` to disable that sandbox. Add `VITE_MAP_STYLE` only if using a custom map style. Configure webhook URLs only after the Render API has a public HTTPS URL.

For a durable hosted deployment, add managed `DATABASE_URL` and verify `GET /health/ready` returns `200`. The checked-in Render service runs migrations at startup; a failed database connection leaves liveness available but keeps readiness at `503` and retries instead of serving mutations against an uninitialized store. Keep `DEMO_AUTH_ENABLED=true` only on the showcase/staging service. For real production, set it to `false`, use a separate database, and set `STRICT_CONFIG=true` after the first successful readiness check.

To enable durable notifications, add managed `REDIS_URL`, set `QUEUE_MODE=bullmq` on the API service, and deploy `render.worker.yaml` as a separate always-on worker. The worker needs the same Redis and Gmail SMTP values. A free Render web-only service must remain on `QUEUE_MODE=inline`; do not claim queued delivery until the worker is running.

The API exposes `POST /api/drivers/:id/location` as a retryable HTTP fallback for mobile clients, while Socket.IO location updates remain the low-latency path. Both persist driver coordinates and generate geofence events. Customer accounts can reschedule, cancel eligible deliveries, request returns after delivery, and receive return decisions from dispatch/admin.

Do not point RoutePulse at another application's database or Redis instance. Take provider-level database backups, configure Uptime Kuma against `/health` and `/health/ready`, and add a GlitchTip-compatible DSN only after the monitoring project exists.
