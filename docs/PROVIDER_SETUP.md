# Provider and deployment setup

The source tree contains no provider secrets. Enter backend values in local `apps/api/.env` and frontend values in `apps/web/.env.local` for development. For deployment, use Render/Vercel dashboard environment variables.

Current local completion requires no additional values: demo JWT auth, PostgreSQL, Redis queue insertion, simulated payment, and simulated email are usable as-is. To activate external services, provide only the values for the provider you want enabled:

| Provider | Put these variables here |
|---|---|
| Clerk | `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, and `AUTH_MODE=clerk` in `apps/api/.env`; `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in `apps/api/.env` |
| Google SMTP | `GOOGLE_SMTP_USER`, `GOOGLE_SMTP_APP_PASSWORD`, `EMAIL_FROM` in `apps/api/.env` |
| Hosted API | managed `DATABASE_URL`, managed `REDIS_URL`, and deployed `WEB_ORIGIN` in Render |
| Hosted web | deployed `VITE_API_URL` and optional `VITE_MAP_STYLE` in Vercel |

Do not paste secret values into chat or commit either environment file. Set them directly in the named local file or hosting dashboard.

## Complete environment reference

### Backend: `apps/api/.env`

| Variable | When it is needed |
|---|---|
| `PORT` | Optional; API port, defaults to `4000` |
| `WEB_ORIGIN` | Required when the frontend is hosted; comma-separated allowed origins |
| `JWT_SECRET` | Required for secure demo JWT sessions; use a long random value outside local development |
| `AUTH_MODE` | Set to `demo` for seeded login or `clerk` for Clerk sessions |
| `DEFAULT_ORGANIZATION_ID` | Clerk fallback tenant; local demo uses `org_demo` |
| `DATABASE_URL` | Required for durable PostgreSQL persistence; without it the API uses memory-demo mode |
| `REDIS_URL` | Required for BullMQ notification queues and the notification worker |
| `CLERK_SECRET_KEY` | Required only when `AUTH_MODE=clerk` |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Required to accept Clerk webhooks |
| `RAZORPAY_KEY_ID` | Required to enable Razorpay checkout |
| `RAZORPAY_KEY_SECRET` | Required to create and verify Razorpay payments |
| `RAZORPAY_WEBHOOK_SECRET` | Required to verify Razorpay webhooks |
| `GOOGLE_SMTP_USER` | Required to send real email instead of simulated notifications |
| `GOOGLE_SMTP_APP_PASSWORD` | Required with `GOOGLE_SMTP_USER`; use an app password |
| `EMAIL_FROM` | Sender address for real email |
| `SMTP_HOST` | Optional SMTP override; defaults to `smtp.gmail.com` |
| `SMTP_PORT` | Optional SMTP override; defaults to `465` |
| `SMTP_SECURE` | Optional SMTP TLS override; defaults to `true` |

### Frontend: `apps/web/.env.local`

| Variable | When it is needed |
|---|---|
| `VITE_API_URL` | API base URL; local default is `http://127.0.0.1:4000` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Required only for Clerk login; leave blank for role-based demo login |
| `VITE_MAP_STYLE` | Optional MapLibre style URL |

Razorpay's public checkout key is returned by the authenticated checkout API; no frontend Razorpay secret or `VITE_RAZORPAY_*` variable is needed.

### Test and deployment controls

| Variable | Purpose |
|---|---|
| `RUN_DB_TESTS=1` | Opts into the PostgreSQL integration test |
| `API_URL` | Optional base URL override for `smoke:runtime` |
| `NODE_VERSION=22` | Render runtime selection, already declared in `render.yaml` |

## Clerk

1. Create a Clerk application and copy the publishable key into Vercel as `VITE_CLERK_PUBLISHABLE_KEY`.
2. Copy the secret key into Render as `CLERK_SECRET_KEY`.
3. Set `AUTH_MODE=clerk`.
4. Configure Organizations and use these organization roles: `org:admin`, `org:dispatcher`, `org:driver`, and `org:customer`.
5. In Clerk Dashboard → Webhooks, add `https://<render-api>/api/webhooks/clerk`; subscribe to user create/update/delete events and copy its signing secret into Render as `CLERK_WEBHOOK_SIGNING_SECRET`.

The API accepts Clerk session tokens, while the webhook synchronizes users into PostgreSQL. Keep organization-to-tenant mapping aligned before enabling multiple organizations.

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

The demo uses MapLibre with a public demo style and requires no key. For a no-cost development setup, use OpenStreetMap tiles with Leaflet and OSRM/Nominatim for routing/geocoding. Public endpoints have fair-use/rate limits and must not be treated as an unlimited production SLA. For production traffic, add a paid/free-tier provider later and proxy requests through the API.

## Free monitoring

- GlitchTip: closest Sentry-compatible self-hosted option; set `GLITCHTIP_DSN`.
- SigNoz: OpenTelemetry logs, metrics, and traces; suitable for a Docker/VM deployment.
- Uptime Kuma: lightweight uptime checks for the Render API and Vercel web URL.

## Render and Vercel

Create the Render services from `render.yaml`. Set `WEB_ORIGIN` on Render to the Vercel URL. On Vercel set `VITE_API_URL` to the Render API URL, `VITE_CLERK_PUBLISHABLE_KEY` to the Clerk publishable key, and `VITE_MAP_STYLE` if using a custom map style. Configure webhook URLs only after the Render API has a public HTTPS URL.
