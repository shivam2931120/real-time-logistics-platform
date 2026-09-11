# Provider and deployment setup

The source tree contains no provider secrets. Enter backend values in local `apps/api/.env` and frontend values in `apps/web/.env.local` for development. For deployment, use Render/Vercel dashboard environment variables.

Current local completion requires no additional values: demo JWT auth, PostgreSQL, Redis queue insertion, simulated payment, and simulated email are usable as-is. To activate external services, provide only the values for the provider you want enabled:

| Provider    | Put these variables here                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clerk       | `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, and `AUTH_MODE=clerk` in `apps/api/.env`; `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local` |
| Razorpay    | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in `apps/api/.env`                                                              |
| Google SMTP | `GOOGLE_SMTP_USER`, `GOOGLE_SMTP_APP_PASSWORD`, `EMAIL_FROM` in `apps/api/.env`                                                                     |
| Hosted API  | managed `DATABASE_URL`, managed `REDIS_URL`, and deployed `WEB_ORIGIN` in Render                                                                    |
| Hosted web  | deployed `VITE_API_URL` and optional `VITE_MAP_STYLE` in Vercel                                                                                     |

Do not paste secret values into chat or commit either environment file. Set them directly in the named local file or hosting dashboard.

## Complete environment reference

### Backend: `apps/api/.env`

| Variable                       | When it is needed                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `PORT`                         | Optional; API port, defaults to `4000`                                                                |
| `WEB_ORIGIN`                   | Required when the frontend is hosted; comma-separated allowed origins                                 |
| `JWT_SECRET`                   | Required for secure demo JWT sessions; use a long random value outside local development              |
| `AUTH_MODE`                    | Set to `demo` for seeded login or `clerk` for Clerk sessions                                          |
| `DEFAULT_ORGANIZATION_ID`      | Clerk fallback tenant; local demo uses `org_demo`                                                     |
| `DATABASE_URL`                 | Required for durable PostgreSQL persistence; without it the API uses memory-demo mode                 |
| `DB_POOL_MAX`                  | Optional PostgreSQL connection cap; defaults to `5` for free poolers                                  |
| `DB_CONNECTION_TIMEOUT_MS`     | Optional database connect timeout; defaults to `15000`                                                |
| `REDIS_URL`                    | Required for BullMQ notification queues and the notification worker when `QUEUE_MODE=bullmq`          |
| `QUEUE_MODE`                   | Use `inline` on a web-only service; use `bullmq` only when a worker is running against the same Redis |
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

The API accepts Clerk session tokens, while the webhook synchronizes user identity, email, and public-metadata role into PostgreSQL. The free deployment uses `DEFAULT_ORGANIZATION_ID=org_demo` as one tenant. Keep organization-to-tenant mapping aligned before enabling multiple organizations.

The production sign-in page includes four public sandbox accounts (admin, dispatcher, driver, and customer) for demonstrations. The preserved owner account is not a sandbox account. The Render migration removes the legacy `@routepulse.demo` users and `RP-DEMO*` records once, preserving the organization and owner account.

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

The checked-in `render.yaml` creates one free web service configured for Clerk authentication and inline notifications. Secret provider values are marked `sync: false` so they remain in Render's dashboard rather than source control. Free Render background workers are not available, so no worker is declared.

After the web frontend is deployed, set `WEB_ORIGIN` on Render to its exact HTTPS origin and set `VITE_API_URL` on Vercel to the Render API URL. Set `VITE_CLERK_PUBLISHABLE_KEY` and switch the backend to `AUTH_MODE=clerk` only when Clerk is configured. Add `VITE_MAP_STYLE` only if using a custom map style. Configure webhook URLs only after the Render API has a public HTTPS URL.

For a durable hosted deployment, add managed `DATABASE_URL`, run the migration and seed commands against the hosted database, and keep `QUEUE_MODE=inline` on a web-only service. To enable BullMQ, add managed `REDIS_URL`, set `QUEUE_MODE=bullmq`, and run `apps/api/dist/workers/notificationWorker.js` on a paid worker or another always-on worker host. Do not point RoutePulse at another application's database or Redis instance. The demo login endpoint is disabled whenever `AUTH_MODE=clerk`.
