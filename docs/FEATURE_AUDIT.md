# RoutePulse feature and UX audit

Reviewed: 8 September 2026. This is a source-level inventory and local verification report, not a claim that every external provider is configured or production-tested. Graphify supplied relationship pointers; findings were checked against the React pages, Express routes, shared contracts and persistence code.

## Existing capabilities

| Workflow                | Present in the application                                                                                                                                                                  | Current boundary / useful next improvement                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and workspaces | Clerk integration, demo sign-in, admin/dispatcher/driver/customer roles, tenant-scoped API access, role administration                                                                      | Verify real Clerk sign-in and role onboarding separately from demo-mode tests.                                                                                           |
| Delivery operations     | Creation, search/status filters, assignment, driver acceptance/rejection, status transitions, delivery windows, exceptions                                                                  | Bulk operations with validation previews and recoverable partial failures.                                                                                               |
| Fleet                   | Location updates, availability, capacity, vehicle plate, shift and maintenance fields                                                                                                       | Maintenance reminders and availability schedules are not a maintenance automation system yet.                                                                            |
| Maps                    | MapLibre, configurable OpenFreeMap style, address search through Nominatim/Photon gateways, road geometry through OSRM gateway, location controls, layers, clustering, stale GPS indicators, capped route concurrency and retry states | External tiles/search/routing can fail or be rate-limited. Road geometry is not a traffic-aware ETA service.                                                             |
| Geofences               | Configurable circular geofences, arrival/departure events, dwell analytics                                                                                                                  | Persisted polygon territories and restricted-area rules are new work.                                                                                                    |
| Routes                  | Capacity-aware optimization, selected stops, drag reordering, distance/duration estimates and map preview                                                                                   | Plans live in page state; there is no durable route-run publishing/versioning workflow.                                                                                  |
| Driver work             | Assigned deliveries, acceptance, GPS sharing, progress updates, issues, parcel scans, proof/PIN                                                                                             | No durable offline action queue or offline conflict-resolution experience.                                                                                               |
| Customer service        | Own deliveries, permitted rescheduling/cancellation, tracking links and support                                                                                                             | Saved addresses, preferred delivery instructions and return requests are new work.                                                                                       |
| Payments                | Razorpay checkout, verification/webhook integration, durable provider references, atomic payment/order writes and webhook deduplication                                                                                                                        | Reconciliation dashboards and refund workflows remain future work. |
| Notifications           | In-app history/read state, SMTP delivery code and BullMQ worker integration                                                                                                                 | Email delivery and background processing depend on configuration and an actually running worker. Do not equate a simulated status with delivered email.                  |
| Support                 | Tickets, categories/priorities/status, order linking and real-time replies                                                                                                                  | SLA ownership/escalation, canned responses and a visible internal-note workflow remain opportunities.                                                                    |
| Parcel scanning         | Manual and browser-camera parcel identification; pickup/hub/delivery scan history                                                                                                           | Camera detection depends on browser support and permission. Offline scans and label-printing are new work.                                                               |
| Analytics and reports   | 7/30/90-day summaries, completion/on-time/payment rates, revenue, risk, status/priority/driver/zone/geofence analysis, CSV exports                                                          | Add historical event-backed trends, comparison periods, saved report filters and cost-per-stop measurements. Direct kilometres are not actual driven kilometres.         |
| Administration          | Team roles, organization settings and audit history                                                                                                                                         | Invitations, operational policy templates and tenant onboarding deserve dedicated workflows.                                                                             |

Primary references: `apps/web/src/App.tsx`, `apps/web/src/pages/`, `apps/web/src/components/LiveMap.tsx`, `apps/api/src/app.ts`, `apps/api/src/services/`, `apps/api/src/db/persistence.ts`, `packages/shared/src/index.ts`.

## UX changes implemented in this pass

- Grouped navigation into Operate, Monitor, Engage and System, with current-page descriptions and a responsive navigation backdrop.
- Added delivery/page search using Ctrl/Cmd + K, empty results, keyboard focus containment, Escape dismissal and focus restoration.
- Added dashboard shortcuts for dispatch, risk review and planning; removed fabricated status dots and unrelated notification counts.
- Replaced hardcoded connection health in the workspace sidebar with Socket.IO connection state.
- Kept existing workspace data and the session during transient failures, with retry messaging; HTTP 401 still clears an invalid session.
- Added destination address search and an explicit manual-coordinate fallback. Coordinates selected from a provider are described as selected, not proof of deliverability.
- Added all delivery statuses, details access before assignment, clear filters, and busy/error feedback on assignment and exports.
- Replaced fleet on-blur writes with explicit save, validation bounds and confirmation; empty filters no longer display a hidden driver's editor.
- Kept analytics labels/export windows tied to successfully loaded data and retained every daily point in 90-day charts.
- Added loading/error/retry states for notifications, exceptions and administration.
- Fixed support creation's post-await form reset, prevented duplicate HTTP/WebSocket messages, guarded stale conversation responses and added submission feedback.
- Improved camera cleanup and scan feedback, added accessible route ordering controls, and preserved a cleared route selection during refreshes.
- Improved mobile menu contrast, dashboard density, map contrast, reduced-motion handling and map loading failure/retry messages.
- Added durable driver GPS history with accuracy/source metadata and a tenant-scoped history endpoint.
- Added period-over-period analytics deltas for orders, revenue, on-time rate and completion rate.
- Lazy-loaded route pages and map/delivery modules so the initial bundle does not include every operational view.
- Added explicit customer action progress and payment/reschedule/cancellation error feedback.

## Recommended next features (not implemented here)

1. **Saved route runs and driver publishing.** Save ordered stops as a versioned route; show draft/published/in-progress/completed states. Reordering must validate capacity and already-completed stops, with optimistic concurrency and a durable driver view.
2. **Route deviation and excessive-dwell alerts.** Persist GPS samples with a retention policy; measure deviation from actual road geometry, apply accuracy/freshness thresholds and hysteresis, and create deduplicated exceptions. Offer acknowledge/snooze/resolve controls.
3. **Offline driver actions.** Queue scans, status changes and proof metadata locally using stable idempotency keys; show pending/synced/conflict states and retry on reconnection. Do not assume permission to bulk-download map tiles.
4. **Service territories and address validation.** Store polygon delivery zones, validate destinations against them and flag out-of-area deliveries before dispatch. Provide a list-based editor and accessible confirmation alongside map drawing.
5. **Customer address book and delivery preferences.** Save verified-by-customer coordinates, landmarks, contact preferences and time-window requests; enforce ownership and audit changes that affect assigned deliveries.
6. **Operational SLA inbox.** Combine late deliveries, stale GPS, long dwell, maintenance due and unresolved tickets into assigned tasks with due times, escalation policies and audit history.
7. **Validated bulk import and batch dispatch.** CSV preview, row-level errors, duplicate detection, dry-run capacity checks and downloadable failure reports; submit bounded, idempotent batches.
8. **Performance comparisons and cost per stop.** Compare equivalent periods and cohorts using event history; separate booked/collected/refunded money, estimated/actual distance and on-time denominator definitions.

Suggested sequence: durable route publishing and payment reconciliation first, then deviation/dwell alerts, then offline driver actions. These can be built with the existing stack; hosted capacity and third-party services may still have costs or usage limits.

## Verification boundary

The automated suite and isolated local browser smoke checks cover UI behavior without changing production data. Local browser tests use demo authentication, in-memory data and disabled payment/email providers. They do not prove Clerk production sign-in, real Razorpay settlement, SMTP delivery, background-worker uptime, or managed-database persistence. External map tile availability is reported separately from a correctly sized map canvas and working page controls.

This UX pass does not include a production deployment.

Local browser evidence: admin demo login, command search, explicit fleet save, manual-coordinate delivery creation, support ticket/reply, mobile navigation, analytics outage recovery and keyboard route ordering passed. At 390px viewport width the document had no horizontal overflow. The external basemap loaded with eight visible map markers and no failed browser requests during the visual check. This is local evidence, not a production map-availability guarantee.
