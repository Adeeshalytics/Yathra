# Yathra — Bus Booking Platform (Phases 0–6)

A production-oriented intercity bus booking platform for Sri Lanka (similar in concept to
Magiya.lk), built in phases:

- **Phase 0** — architecture, data model, authentication, role-based access control,
  developer environment and a reusable UI kit.
- **Phase 1** — the admin management system: dashboard, operators, buses, reusable seat
  layouts (with a visual editor), routes with ordered stops, and stops. See
  [§12](#12-phase-1-admin-management).
- **Phase 2** — trips and recurring schedules. See [§13](#13-phase-2-trips--schedules).
- **Phase 3** — customer search and discovery, with a graphical seat map. See
  [§14](#14-phase-3-customer-search--discovery).
- **Phase 4** — real-time seat locking and the booking engine. See
  [§15](#15-phase-4-seat-locking--booking-engine).
- **Phase 5** — payments and e-tickets: a pluggable gateway layer (PayHere plus a built-in
  test gateway), webhook-verified confirmation, QR e-tickets with PDF download, and the admin
  payments screens. See [§16](#16-phase-5-payments--e-tickets).
- **Phase 6** — the customer account: a dashboard of upcoming, previous and cancelled trips,
  full booking details, self-service cancellation under a configurable refund policy, refund
  records, and profile and password management. See
  [§17](#17-phase-6-customer-account--booking-management).
- **Phase 7** — the office: every booking, passenger management and the printable trip
  manifest, seven reports with CSV/Excel/PDF exports, and dashboard charts — all aggregated by
  the database. See [§18](#18-phase-7-admin-bookings-passengers--reporting).
- **Hardening** — the security audit, query budgets, structured logging and the documentation
  set. See [§19](#19-mvp-hardening).
- **Route maps** — the journey drawn on OpenStreetMap along the real road, for customers and
  administrators. See [§20](#20-route-maps).
- **Launch pack** — tickets by SMS and e-mail with reminders and a shareable ticket link, booking
  with just a phone number, "Find my booking", and the operator portal. See
  [§21](#21-launch-pack-tickets-by-text-phone-sign-in-operator-portal).

| Layer    | Stack |
|----------|-------|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · TanStack Query 5 · React Hook Form · Zod 4 |
| Backend  | Django 5.2 LTS · Django REST Framework · SimpleJWT · PostgreSQL 17 · Redis 7 (cache/throttling) · drf-spectacular (OpenAPI) |
| Tooling  | Docker Compose · pytest · ruff · ESLint · `tsc` |

> "Yathra" is a working name. Change it with `APP_NAME` (backend) and `NEXT_PUBLIC_APP_NAME` (frontend).

### Documentation

| Guide | For |
|-------|-----|
| [docs/setup.md](docs/setup.md) | Running it locally, seed accounts, day-to-day commands, troubleshooting |
| [docs/environment.md](docs/environment.md) | Every environment variable, what is secret, and which settings module reads it |
| [docs/database.md](docs/database.md) | Schema, constraints, indexes, migrations, backups |
| [docs/api.md](docs/api.md) | Authentication, the error envelope, and every endpoint |
| [docs/admin-guide.md](docs/admin-guide.md) | How the office actually uses the admin console |
| [docs/route-maps.md](docs/route-maps.md) | The route map: what it draws, the tile server, and the path to live GPS |
| [docs/notifications.md](docs/notifications.md) | Tickets by SMS and e-mail, reminders, ticket links, Find my booking, Notify.lk and SMTP set-up |
| [docs/phone-sign-in.md](docs/phone-sign-in.md) | Booking with just a phone number: the code flow and its security rules |
| [docs/operator-portal.md](docs/operator-portal.md) | What bus companies see, who may see the money, and the operator API |
| [docs/deployment.md](docs/deployment.md) | Building, configuring and releasing to staging or production |

The rest of this file is the architecture and the record of what each phase delivered.

---

## 1. Folder structure

```text
bus-booking-system/
├── docker-compose.yml          # db, redis, backend, frontend for local development
├── .env.example                # Compose variables (copy to .env)
├── docs/                       # setup · environment · database · api · admin-guide · deployment
├── backend/                    # Django REST API
│   ├── Dockerfile              # targets: development | production (gunicorn, non-root)
│   ├── .env.example            # for running Django directly on the host
│   ├── pyproject.toml          # ruff + pytest configuration
│   ├── requirements/           # base.txt, dev.txt, prod.txt (pinned)
│   ├── manage.py
│   ├── conftest.py             # shared pytest fixtures
│   ├── config/
│   │   ├── settings/           # base · development · test · staging · production
│   │   ├── urls.py             # /django-admin/, /api/v1/, /api/docs/
│   │   ├── api_urls.py         # everything under /api/v1/
│   │   ├── wsgi.py · asgi.py
│   └── apps/
│       ├── core/               # base models, request-id middleware, JSON logging + business
│       │                       # events, error envelope, pagination, health check, reporting
│       │                       # helpers (date ranges, CSV/Excel/PDF exports), file renderers,
│       │                       # seed command, factories, admin_viewsets.py (shared admin API
│       │                       # base: RBAC, audit, safe delete), and the cross-cutting tests:
│       │                       # MVP flow, query budgets, security audit, event logging
│       ├── audit/              # ActivityLog: append-only record of admin changes
│       ├── dashboard/          # /admin/dashboard/ summary endpoint
│       ├── accounts/           # custom User (email login, roles), JWT auth views, RBAC
│       ├── operators/          # Operator companies + OperatorMembership (multi-operator)
│       ├── fleet/              # Bus (facilities), SeatLayout + Seat, layout generator/validator
│       ├── routes/             # Stop, Route, RouteStop (+ public stops/routes API)
│       ├── trips/              # Trip (scheduled run of a bus on a route)
│       ├── bookings/           # Booking, Passenger, SeatLock, pricing, the booking engine,
│       │                       # cancellation.py (the refund policy), dashboard selectors
│       ├── payments/           # Payment + PaymentEvent + Refund, provider layer (PayHere, test
│       │                       # gateway), checkout/webhook/refund services, admin payments
│       │                       # and refund-queue APIs
│       ├── tickets/            # Ticket: signed QR codes and printable PDF e-tickets
│       └── reports/            # the seven admin reports, aggregated by the database
└── frontend/                   # Next.js app
    ├── Dockerfile              # targets: development | production (standalone output)
    ├── .env.example
    ├── next.config.ts          # standalone output, security headers
    └── src/
        ├── app/
        │   ├── layout.tsx      # root: fonts, providers (Query, session, toasts)
        │   ├── (public)/       # public layout: landing page, /search
        │   ├── (auth)/         # auth layout: /login, /register
        │   ├── (customer)/     # customer layout (guarded): /account (+ /profile),
        │   │                   # /bookings/[id] (+ /checkout, /payment, /ticket)
        │   ├── admin/          # admin console (guarded): dashboard, operators, buses,
        │   │                   # seat-layouts, routes, stops, trips (+ manifest), schedules,
        │   │                   # bookings, passengers, payments, refunds, reports
        │   ├── operator/       # operator portal foundation (guarded)
        │   ├── not-found.tsx · error.tsx · global-error.tsx · */loading.tsx
        ├── components/
        │   ├── ui/             # shadcn/ui primitives (button, input, dialog, table, …)
        │   ├── common/         # data-table, confirm-dialog, empty/error states, spinner…
        │   ├── forms/          # RHF-bound TextField / PasswordField
        │   ├── layout/         # site header/footer, dashboard shell, user menu
        │   ├── admin/          # admin screens per module + shared list/record controls
        │   ├── map/            # Leaflet route map, markers and the coordinate picker
        │   ├── seats/          # SeatMap: renders a stored seat layout (editor + previews)
        │   ├── booking/        # review, checkout, payment result, e-ticket, cancellation dialog
        │   ├── account/        # dashboard (tabs, summary, booking list) and profile settings
        │   ├── auth/ landing/ search/ trip/ operator/ brand/ providers/
        ├── hooks/use-auth.ts   # session state + login/register/logout
        └── lib/
            ├── api/            # fetch client, ApiError, endpoints, types, query keys
            ├── auth/           # in-memory session store, role routing
            ├── validations/    # Zod schemas (auth, account, search, phone, booking)
            ├── env.ts          # validated public env vars
            ├── payment.ts      # hand-off to the gateway, payment phases, file saving
            └── format.ts       # LKR, dates (Asia/Colombo), durations
```

---

## 2. Quick start (everything in Docker)

Prerequisites: Docker Desktop.

```bash
cp .env.example .env          # then set POSTGRES_PASSWORD and DJANGO_SECRET_KEY
docker compose up --build
```

| Service   | URL |
|-----------|-----|
| Frontend  | http://localhost:3000 |
| API       | http://localhost:8000/api/v1/ |
| API docs  | http://localhost:8000/api/docs/ (Swagger, dev only) |
| Django admin | http://localhost:8000/django-admin/ |

The backend container runs migrations on start. Load sample data (stops, routes, operators,
trips and one account per role):

```bash
docker compose exec backend python manage.py seed_dev_data
```

| Role     | Email                | Password (dev only) |
|----------|----------------------|---------------------|
| Admin    | admin@yathra.test    | `Yathra@Dev2026` |
| Operator | operator@yathra.test | `Yathra@Dev2026` |
| Customer | customer@yathra.test | `Yathra@Dev2026` |

Pass `--password` to choose your own. The command refuses to run when `DEBUG=False`.

---

## 3. Running PostgreSQL (and Redis)

PostgreSQL 17 and Redis 7 run from Compose, with data kept in named volumes:

```bash
docker compose up -d db redis        # start only the data stores
docker compose ps                    # both should be "healthy"
docker compose exec db psql -U yathra -d yathra   # SQL shell
docker compose down                  # stop (data is kept)
docker compose down -v               # stop AND delete all data
```

They are published on `localhost:5432` and `localhost:6379` (override with `POSTGRES_PORT`
/ `REDIS_PORT`), so Django running on your host can use them too. Redis is optional in
development: leave `REDIS_URL` empty and Django falls back to an in-memory cache.

---

## 4. Running the backend on your machine

Requires Python 3.12+ (3.13/3.14 tested).

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements/dev.txt
cp .env.example .env              # set DJANGO_SECRET_KEY and the DATABASE_URL password
python manage.py migrate
python manage.py seed_dev_data    # optional sample data
python manage.py runserver        # http://localhost:8000
```

`manage.py` uses `config.settings.development` by default; set `DJANGO_SETTINGS_MODULE` to
switch (`config.settings.production`, `config.settings.test`).

Quality checks:

```bash
pytest                 # 203 tests against PostgreSQL (auth, RBAC, admin APIs, constraints)
ruff check . && ruff format --check .
python manage.py makemigrations --check --dry-run
```

## 5. Running the frontend on your machine

Requires Node.js 20+ (24 tested).

```bash
cd frontend
npm install
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
npm run dev                       # http://localhost:3000
```

```bash
npm run check    # next typegen + tsc --noEmit + eslint + vitest
npm run test     # Vitest + Testing Library (forms, validation, seat layouts)
npm run build    # production build (standalone output)
```

---

## 6. Environment variables

Nothing secret is committed. Each app has an `.env.example`; real `.env` files are git-ignored.

### Root `.env` (Docker Compose)

| Variable | Purpose |
|----------|---------|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database created by the `db` container; also used to build the backend's `DATABASE_URL` |
| `POSTGRES_PORT`, `REDIS_PORT` | Host ports for the data stores |
| `DJANGO_SECRET_KEY` | Django signing key (also the default JWT signing key) — **required** |
| `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_LOG_LEVEL` | Passed to the backend |
| `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` | Browser origins allowed to call the API |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES`, `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | Token lifetimes |
| `PAYMENT_PROVIDERS`, `FRONTEND_URL`, `PUBLIC_API_URL` | Which payment gateways are offered, and the URLs gateways send customers and notifications back to |
| `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`, `PAYHERE_SANDBOX`, `PAYHERE_APP_ID`, `PAYHERE_APP_SECRET` | PayHere credentials (leave empty to keep PayHere switched off) |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_NAME` | Passed to the frontend |

### Backend (`backend/.env` or real environment)

| Variable | Default | Notes |
|----------|---------|-------|
| `DJANGO_SECRET_KEY` | — | Required |
| `DJANGO_DEBUG` | `false` (`true` in development settings) | |
| `DJANGO_ALLOWED_HOSTS` | localhost (dev) | Required in production |
| `DATABASE_URL` | — | `postgres://user:pass@host:5432/db` |
| `DB_CONN_MAX_AGE` | `60` | Persistent connections (seconds) |
| `REDIS_URL` | empty | Enables Redis cache/throttling when set |
| `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` | localhost:3000 (dev) | Comma-separated |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` / `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | `15` / `7` | |
| `JWT_SIGNING_KEY` | `DJANGO_SECRET_KEY` | Rotate independently if desired |
| `JWT_REFRESH_COOKIE_NAME` / `_DOMAIN` / `_SECURE` / `_SAMESITE` | `yathra_refresh` / host-only / `true` (false in dev) / `Lax` | Set `_DOMAIN=.yourdomain.lk` when app and API are on sibling subdomains |
| `THROTTLE_RATE_ANON` / `_USER` / `_AUTH` | `120/min` / `600/min` / `10/min` | `auth` applies to login + register |
| `DJANGO_LOG_FORMAT` | `console` | `json` for log shipping |
| `DJANGO_ADMIN_URL` | `django-admin/` | Use a non-obvious path in production |
| `API_DOCS_ENABLED` | `true` in dev, `false` otherwise | Serves `/api/schema/` and `/api/docs/` |
| `APP_NAME`, `BOOKING_REFERENCE_PREFIX` | `Yathra`, `YT` | Branding |
| `SEAT_LOCK_MINUTES`, `SEAT_LOCK_THROTTLE_RATE` | `5`, `60/min` | How long seats are held while booking, and how fast one account may lock seats |
| `BOOKING_SERVICE_FEE_PER_SEAT`, `BOOKING_SERVICE_FEE_PERCENT`, `BOOKING_TAX_PERCENT` | `0` | Extras on top of the ticket price |
| `BOOKING_CANCELLATION_TIERS` | `48:100,24:75,6:50` | Refund tiers as `hours before departure:percent` |
| `BOOKING_CANCELLATION_CUTOFF_HOURS` | `6` | Inside this, only support can cancel |
| `BOOKING_CANCELLATION_FEE_PER_BOOKING`, `BOOKING_CANCELLATION_FEE_PERCENT` | `0` | Kept back from every refund |
| `PAYMENT_PROVIDERS` | `mock` in debug, otherwise empty | Gateways offered at checkout, in order: `payhere` and/or `mock` (the test gateway). Production refuses to start with `mock` unless `ALLOW_MOCK_PAYMENTS=true` |
| `PAYMENT_DEFAULT_PROVIDER` | first enabled | Pre-selected at checkout |
| `FRONTEND_URL`, `PUBLIC_API_URL` | `http://localhost:3000` / `:8000` | Return and notification URLs given to gateways — both must be reachable from the customer's browser (and `PUBLIC_API_URL` from the gateway's servers) |
| `PAYMENT_WINDOW_MINUTES` / `PAYMENT_MAX_HOLD_MINUTES` | `10` / `20` | Seats are held this long once payment starts, capped per booking |
| `PAYMENT_TIMEOUT_MINUTES` | `30` | When `reconcile_payments` gives up on an attempt the gateway never reported |
| `PAYMENT_VERIFY_THROTTLE_RATE` | `20/min` | Customer-triggered status checks |
| `MOCK_PAYMENT_SECRET` | derived from `DJANGO_SECRET_KEY` | Signs the test gateway's notifications |
| `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET` | empty | PayHere credentials; PayHere is only offered when both are set |
| `PAYHERE_SANDBOX` | `true` | `false` uses `www.payhere.lk` instead of the sandbox |
| `PAYHERE_APP_ID`, `PAYHERE_APP_SECRET` | empty | Optional Business App keys: enable status look-ups and refunds through PayHere's API |
| `DJANGO_SECURE_SSL_REDIRECT`, `DJANGO_SECURE_HSTS_*` | secure defaults | Production only |

### Frontend (`frontend/.env.local` or build args)

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | Absolute API base incl. version, e.g. `https://api.example.lk/api/v1`. Required for production builds (validated with Zod at build time). |
| `NEXT_PUBLIC_APP_NAME` | Display name |

`NEXT_PUBLIC_*` values are embedded in the browser bundle — never put secrets in them.

---

## 7. Database & migrations

The schema is defined by Django models and versioned with Django migrations
(`backend/apps/*/migrations/`). Every app ships an initial migration.

```bash
python manage.py makemigrations          # after changing models
python manage.py migrate                 # apply
python manage.py showmigrations          # status
python manage.py sqlmigrate trips 0001   # inspect the SQL
# In Docker:
docker compose exec backend python manage.py migrate
```

Design notes:

- **UUID primary keys** everywhere (non-enumerable, safe in URLs); `created_at`/`updated_at` on every table.
- **Foreign keys use `PROTECT`** for business records (a bus with trips, a trip with bookings, a booking with payments cannot be deleted by accident); `CASCADE` only for owned children (route stops, passengers, memberships).
- **Constraints in the database**, not just in Python: unique email/phone/registration numbers, `unique(bus, departure_datetime)` (no double-scheduling), `unique(route, sequence)` (deferred, so stops can be re-ordered in one transaction), `unique(booking, seat_number)`, check constraints for enums, positive prices, seat capacity, coordinates, `departure_offset ≥ arrival_offset`, and "a succeeded payment has `paid_at`".
- **Indexes** on the hot paths: route search (`origin, destination, active`), trips by `route + departure` and `status + departure`, a customer's bookings by date, operator/bus lookups, payment status.
- **Multi-operator ready**: buses belong to an `Operator`; operator users are linked through `OperatorMembership` (owner/manager/staff), so a company can have many staff and data is scoped per operator.
- **Transactions**: customer registration runs atomically and converts race-condition `IntegrityError`s into friendly validation errors; booking references are generated with `secrets` and retried inside a savepoint on the (astronomically unlikely) collision; the seed command is atomic.
- **Passwords** are hashed with Argon2 (PBKDF2 fallback) — never stored in plain text.

---

## 8. Authentication architecture

```mermaid
sequenceDiagram
    participant B as Browser (Next.js)
    participant A as Django API
    B->>A: POST /api/v1/auth/login {email, password}
    A-->>B: 200 {access, user} + Set-Cookie: refresh (HttpOnly, path=/api/v1/auth/)
    Note over B: access token kept in memory only
    B->>A: GET /api/v1/bookings/ (Authorization: Bearer access)
    A-->>B: 200 (role checked from the database on every request)
    Note over B: access expires after 15 min
    B->>A: POST /api/v1/auth/refresh/ (cookie sent automatically)
    A-->>B: 200 {access, user} + rotated refresh cookie (old one blacklisted)
    B->>A: POST /api/v1/auth/logout/
    A-->>B: 204, refresh token blacklisted, cookie cleared
```

- **Tokens**: SimpleJWT. Access tokens (15 min) are returned in the JSON body and held **only in
  memory** in the browser — never in `localStorage`. Refresh tokens (7 days) live in an
  **HttpOnly, SameSite=Lax, Secure (prod)** cookie scoped to `/api/v1/auth/`, so JavaScript
  can't read them and they aren't sent to other endpoints.
- **Rotation & revocation**: every refresh issues a new refresh token and blacklists the old one;
  logout blacklists the current one. Tokens embed a hash of the password, so changing a password
  invalidates every existing token. Refresh also re-checks that the user still exists and is active.
- **Session restore**: on page load the frontend calls `/auth/refresh/` once (only if a non-secret
  "has session" hint is present) to obtain a fresh access token. Concurrent refreshes share one
  request; tabs stay in sync through a `storage` event.
- **Transparent renewal**: the API client retries a request once after a 401 by refreshing the
  token; if refresh fails the session ends and protected pages redirect to `/login?next=…`.
- **Roles**: `customer`, `operator`, `admin` on the single `User` model. Self-registration always
  creates customers; operators and admins are provisioned (Django admin / seed). One login endpoint
  serves every role; the frontend routes users to `/account`, `/operator` or `/admin`.
- **RBAC on the API** (the real security boundary): `IsCustomer`, `IsOperator`, `IsAdmin`,
  `IsAdminOrOperator` and `IsActiveOperatorMember` (operator role **and** an active membership of an
  approved company; sets `request.operator` for query scoping). Querysets are scoped to the caller
  (customers only ever query their own bookings).
- **RBAC in the UI** (UX only): `RequireAuth roles={[…]}` guards route groups, shows a loader
  while the session is restored and an "access denied" state for the wrong role; `next` redirects
  are validated (no open redirects, no cross-role targets).
- **Hardening**: rate limiting (10/min on login/register), CORS allow-list with credentials,
  Argon2 hashing, Django password validators mirrored in Zod, case-insensitive unique emails,
  normalised E.164 phone numbers.

### API (v1)

| Method & path | Access | Purpose |
|---------------|--------|---------|
| `GET /api/v1/health/` | public | DB + cache readiness probe |
| `POST /api/v1/auth/register/` | public | Create customer account, start session |
| `POST /api/v1/auth/login/` | public | Log in (any role) |
| `POST /api/v1/auth/refresh/` | refresh cookie | New access token (rotates refresh) |
| `POST /api/v1/auth/logout/` | refresh cookie | Blacklist token, clear cookie |
| `GET /api/v1/auth/me/` · `PATCH` | authenticated | Current user; PATCH edits their own name, phone and email |
| `POST /api/v1/auth/password/` | authenticated | Change password (answers with a fresh session) |
| `GET /api/v1/stops/` · `/stops/{id}/` | public | Active stops (`?search=`, `?city=`) |
| `GET /api/v1/routes/` · `/routes/{id}/` | public | Routes with duration, stop count, lowest upcoming fare; detail includes ordered stops |
| `GET /api/v1/bookings/` · `/bookings/{id}/` | customer (own) / admin | Booking history: `?scope=upcoming\|past\|cancelled`, `?status=`, `?search=`, `?date_from=`, `?date_to=` |
| `GET /api/v1/bookings/summary/` | customer | Dashboard counts, total paid and the next departure |
| `GET /api/v1/bookings/{id}/cancellation/` · `POST {id}/cancel/` | customer (own) / admin | What the policy allows and refunds, and cancelling itself |
| `GET /api/v1/refunds/` · `/refunds/{id}/` | customer (own) / admin | Refunds owed to the caller |
| `GET /api/v1/bookings/{id}/ticket/` · `/ticket/pdf/` | customer (own) / admin | The e-ticket with its QR code, and the printable PDF |
| `GET /api/v1/payments/providers/` | customer | Gateways offered at checkout |
| `POST /api/v1/payments/` | customer (own booking) | Pay Now: opens an attempt, returns the gateway checkout |
| `GET /api/v1/payments/{id}/` · `POST {id}/verify/` · `POST {id}/cancel/` | customer (own) / admin | Follow a payment, ask the server to check with the gateway, or cancel the attempt |
| `POST /api/v1/payments/webhooks/{provider}/` | the gateway (signed) | Gateway notifications — the only thing that confirms a booking |
| `GET /api/v1/tickets/verify/?code=` | admin / operator | Check a scanned ticket at the bus door |
| `/api/v1/admin/payments/` | admin | Payment list and detail with its event timeline, `{id}/refund/`, `{id}/reconcile/`, `summary/` |
| `/api/v1/admin/refunds/` | admin | The refund queue; `POST {id}/status/` moves one to processing, completed or rejected |
| `GET /api/v1/operator/profile/` | operator | The caller's company |
| `GET /api/v1/admin/dashboard/` | admin | Counts, upcoming-trip preview, recent activity |
| `GET /api/v1/admin/activity/` | admin | Admin change history (`?entity_type=`, `?action=`) |
| `/api/v1/admin/operators/` | admin | CRUD, `?status=`, search, `{id}/activate/` · `{id}/deactivate/` |
| `/api/v1/admin/buses/` | admin | CRUD, `?operator=` `?bus_type=` `?facility=` `?active=`, activate/deactivate |
| `/api/v1/admin/seat-layouts/` | admin | CRUD with nested `seats`, `POST generate/` (2+2 / 2+1 templates), activate/deactivate |
| `/api/v1/admin/routes/` | admin | CRUD with ordered `stops`, `?origin=` `?destination=` `?stop=` `?active=`, activate/deactivate |
| `/api/v1/admin/stops/` | admin | CRUD, `?city=` `?active=`, search, `GET cities/`, activate/deactivate |

Admin lists are paginated (`?page=`, `?page_size=` ≤ 100), searchable (`?search=`) and
sortable (`?ordering=`). Deleting a record that is still in use (an operator with buses, a
bus or route with trips, a layout assigned to buses, a stop on a route) returns **409
Conflict** with an explanation instead of deleting it.

Every error uses one envelope, and every response carries an `X-Request-ID` header that also
appears in the logs:

```json
{ "error": { "code": "validation_error", "message": "Please correct the highlighted fields.",
             "details": { "email": ["An account with this email already exists."] },
             "request_id": "9f1c…" } }
```

---

## 9. Frontend ↔ backend communication

- `src/lib/api/client.ts` is the single HTTP entry point: base URL from `NEXT_PUBLIC_API_URL`,
  JSON handling, `credentials: "include"` for the refresh cookie, bearer token injection,
  one-shot refresh-and-retry on 401 and conversion of error envelopes into `ApiError`
  (with field errors mapped straight onto React Hook Form inputs).
- TanStack Query handles caching, loading and error states (no retries on 4xx).
- Live integrations in Phase 0: the landing page's From/To pickers (`/stops/`), popular routes
  (`/routes/`), login/register/logout/refresh, the customer's bookings, the operator profile and
  the admin operators table.

---

## 10. Production notes

- Build targets: `docker build --target production ./backend` (gunicorn, non-root, static files
  collected, WhiteNoise) and `docker build --target production --build-arg NEXT_PUBLIC_API_URL=… ./frontend`
  (Next.js standalone server).
- Run `python manage.py migrate` as a release step before starting new backend containers.
- Production settings enforce `DEBUG=False`, HTTPS redirect, HSTS, secure cookies, and require
  `DJANGO_ALLOWED_HOSTS`. Use `DJANGO_LOG_FORMAT=json` for structured logs.
- Serve the app and API on sibling subdomains (e.g. `yathra.lk` and `api.yathra.lk`) so the
  refresh cookie stays same-site; set `CORS_ALLOWED_ORIGINS` to the app origin.
- Redis is already wired for caching and throttling; the same instance can back Celery
  (e-mails/SMS, seat-hold expiry) in a later phase.
- **Scheduled jobs** (cron or Celery beat): `python manage.py expire_seat_holds` every minute,
  and `python manage.py reconcile_payments` every few minutes so late or lost gateway
  notifications still settle.
- **Payments**: set `PUBLIC_API_URL` to a public HTTPS address — gateways POST their
  notifications to `/api/v1/payments/webhooks/{provider}/`, and that is what confirms bookings.
  Keep `PAYMENT_PROVIDERS=payhere` in production; the `mock` test gateway is refused there.

## 11. What's next (Phase 8+)

Delivered since: notifications and operator self-service ([§21](#21-launch-pack-tickets-by-text-phone-sign-in-operator-portal)).
Still to come: a crew boarding scanner, Sinhala and Tamil, an admin editor for the cancellation
policy, platform settings.

---

## 12. Phase 1: admin management

Sign in as `admin@yathra.test` and open **/admin**. The sidebar lists every planned module;
Trips, Bookings, Passengers, Payments, Reports and Settings are marked *Soon*.

| Module | What admins can do |
|--------|--------------------|
| Dashboard | Total / active buses and routes, operators by status, upcoming-trip preview, recent activity feed |
| Operators | Create, edit, view (with their fleet), activate (approve) / deactivate (suspend), delete when they own no buses, search, filter by status |
| Buses | Add, edit, view (with seat-map preview), activate/deactivate, assign to an operator, registration number, type (Normal / AC / Luxury / Super Luxury), capacity, seat layout, facilities (AC, WiFi, USB charging, reclining seats, TV, toilet); filter by operator, type, facility, status |
| Seat layouts | Visual editor: generate a 2+2 or 2+1 template, paint seat types (window, aisle, normal, reserved, driver, conductor), block/unblock seats, edit seat numbers, resize the grid, renumber; live validation |
| Routes | Create/edit with an ordered stop list (drag-and-drop or up/down), boarding / drop-off flags, arrival and departure offsets, standard fare; view as a timetable; activate/deactivate; delete when no trips |
| Stops | Create/edit in a dialog, search, filter by city and status, activate/deactivate, delete when unused |

**Seat layouts** are stored as a `SeatLayout` (grid `rows × columns`, pattern) plus one `Seat`
row per occupied cell (`seat_number`, `row`, `column`, `seat_type`, `is_available`). Buses point
at a layout, so one design serves a whole fleet, and the customer booking screen will render
the same grid with the shared `SeatMap` component. Only available normal/window/aisle seats are
bookable; reserved seats exist but aren't sold online; driver and conductor seats are never
sellable (enforced by a database check constraint). A bus's capacity can't exceed its layout's
bookable seats, and a layout can't be edited below the capacity of any bus using it.

**Validation** (API, mirrored in the forms): duplicate registration numbers in any format
(`nb 1234` = `NB-1234` = `WP NB-1234`); routes need ≥ 2 distinct stops, an origin at minute 0
with boarding, a destination with drop-off, departures not before arrivals and each stop reached
after leaving the previous one; stop names are unique per city regardless of case; fares and
offsets can't be negative; seat layouts need exactly one driver, ≤ 2 conductors, ≥ 1 passenger
seat, unique positions and seat numbers inside the grid.

**Activity log**: every admin create / update (with the changed fields) / delete /
activate / deactivate is recorded in `ActivityLog` and shown on the dashboard.

---

## 13. Phase 2: trips & schedules

The admin flow is now **Operator → Bus → Seat layout → Route → Stops → Trip**. Open
**/admin/trips** (one-time trips) or **/admin/schedules** (recurring timetables).

| Screen | What admins can do |
|--------|--------------------|
| Trips list | Trip ID, route, bus, operator, date, departure/arrival, price, available seats, status; search; filter by date, upcoming/past, route, bus, operator, status |
| New / edit trip | Assign route and bus, set departure date & time and ticket price (defaults to the route's fare), put on / take off sale, adjust the estimated arrival and departure at every stop |
| Trip detail | Route, bus (type, layout, facilities, operator), seat capacity, departure, arrival, journey time, all stops with their timings, price, booking count, available seats; status changes, cancel (with reason), sale on/off, reset stop times to the route timetable, delete (only without bookings) |
| Schedules | Daily or selected-weekday departures with a validity window; preview then **generate** individual trips for any date range (up to 92 days at a time) |

**Data model** (`apps/trips`):

- `Trip` — `code` (e.g. `TR7KQ2M9`), `route`, `bus`, `operator`, optional `schedule`,
  `departure_datetime`, `estimated_arrival_datetime`, `status`
  (Scheduled / Boarding / Departed / Completed / Cancelled), `base_price`, `active` (on sale),
  cancellation reason & time, timestamps. The operator is stored rather than read through the
  bus, so history stays right if a bus changes hands; moving a bus to another operator moves
  its not-yet-departed trips and its schedules with it.
- `TripStop` — the trip's own timetable: arrival and departure datetimes per stop. It is copied
  from the route's offsets when the trip is created and editable per trip, so later route edits
  never move journeys that are already on sale.
- `TripSchedule` — route, bus, departure time, price, `daily` / `weekly` + weekdays, start and
  optional end date, and how far trips have been generated.

**Rules** (API, mirrored in the forms): a trip needs an active route with a stop timetable and
an active bus with a seat layout run by an approved operator; the departure must be in the
future; the first stop matches the departure, every stop is reached after leaving the previous
one and journeys are at most 72 hours; only *scheduled* trips can be edited; statuses move
Scheduled → Boarding → Departed → Completed (boarding can go back to scheduled); cancelled and
completed trips can't be put back on sale; a bus's capacity can't drop below the seats already
booked on its upcoming trips. **A bus can never run two overlapping journeys**: a PostgreSQL
exclusion constraint (`btree_gist`) on `(bus, [departure, arrival))` enforces it for every code
path, ignoring cancelled trips; the API explains which trip is in the way.

Generating from a schedule is idempotent: days that already have the trip, lie in the past, or
clash with another journey of the bus are skipped and reported. Deleting a schedule keeps the
trips it created. Stop times entered in the UI are Sri Lankan clock times (UTC+05:30, no
daylight saving); a time earlier than the previous stop's rolls over to the next day, so
Colombo 20:30 → Dambulla 00:30 → Batticaloa 05:30 needs no date juggling.

The development seed creates 15 schedules and 14 days of trips, including the night service
`WP NC-4521` Colombo → Batticaloa at 20:30 for LKR 2,500 (Kadawatha 21:00, Kurunegala 22:30,
Dambulla 00:30, Batticaloa 05:30).

APIs: `/api/v1/admin/trips/` (CRUD + `activate`, `deactivate`, `cancel`, `status`,
`reset-timings`) and `/api/v1/admin/trip-schedules/` (CRUD + `activate`, `deactivate`,
`generate` with `dry_run`).

---

## 14. Phase 3: customer search & discovery

Customers search from the home page (or **/search**) by *from*, *to*, travel date and passenger
count, compare buses, then open a trip (**/trips/{id}**) to choose seats and where to get on
and off. Seat booking and payment are **not** part of this phase: the selection is shown in the
summary but nothing is held or charged.

**How matching works.** A trip matches when it has a boarding point in the *from* city and a
later drop-off point in the *to* city, so the Colombo → Batticaloa night bus is also offered
for Kurunegala → Dambulla. Places are stop ids (from the pickers) or city / stop names
(`?from=Colombo`); all stops in a city count. The travel date is the day the customer
**boards at their stop**, which matters for night buses that pass a town after midnight. Only
trips that are scheduled, on sale, run by an active operator on an active bus and route, with
enough free seats for every passenger and a boarding point still ahead, are shown.

| Endpoint (public) | Purpose |
|-------------------|---------|
| `GET /api/v1/trips/search/?from=&to=&date=&passengers=` | Paginated results for the customer's own journey: operator, bus, type, boarding → drop-off times, journey duration, price per seat, seats left, route, boarding and drop-off points. Also returns `facets` (counts per filter option), `route_exists` and `nearest_available_date` for empty days. |
| `GET /api/v1/trips/{id}/` | Full route, every stop with estimated times, bus information and facilities, price, seats left |
| `GET /api/v1/trips/{id}/stops/[?boarding=<stop id>]` | All stops plus the valid boarding points and the drop-off points reachable from them |
| `GET /api/v1/trips/{id}/seats/` | The seat layout with each seat's status for the trip: `available`, `booked` or `unavailable` |

Search options: `sort` = `departure`, `-departure`, `price`, `-price`, `duration`, `seats`;
filters `bus_type` (comma-separated), `ac` (`true`/`false`), `min_price`, `max_price`,
`departure` (`early_morning`, `morning`, `afternoon`, `evening` — by boarding time) and
`operator` (comma-separated ids); `page`, `page_size`. Invalid input returns 400 with
field-level messages (unknown place, same origin and destination, past date, more than 180 days
ahead, 1–10 passengers, bad filter values, min price above max).

**Seat statuses.** Seats held by pending or confirmed bookings are `booked`. Driver, conductor,
reserved and blocked seats are `unavailable`, and so are seats beyond the bus's *seats for
sale* (the first `seat_capacity` bookable seats, front to back, are sold).

**The results page** keeps every criterion, filter, sort and page in the URL (shareable, back
button friendly). It has a date strip, a filter sidebar (a sheet on mobile) with counts, sort
options, bus cards with an expandable list of boarding and drop-off points, and clear states
for no route, no buses that day (with a jump to the nearest day), no match for the filters,
past dates, invalid searches, loading and API errors.

**The trip page** draws the bus from above (front, windscreen, door, steering wheel) with every
seat colour-coded: available, your seat, booked, not for sale. Customers pick up to one seat
per passenger (one passenger simply swaps seats), choose a boarding point and only the drop-off
points after it, and see the full route timeline with their part highlighted, bus information
and facilities, and a price summary. Seat availability refreshes every 20 seconds; if someone
else books a chosen seat meanwhile, it is dropped with a notice.

The development seed sells a few seats on the next trips of the Colombo – Batticaloa, Colombo
– Kandy and Colombo – Jaffna routes (as walk-in counter sales), so booked seats show on the
seat maps.

---

## 15. Phase 4: seat locking & booking engine

**Customer flow** (on `/trips/{id}`): boarding point → drop-off point → seat selection →
passenger details → **booking review** (`/bookings/{id}`) → payment ([§16](#16-phase-5-payments--e-tickets)).

**Seat states** (per trip, from `GET /api/v1/trips/{id}/seats/`, using the admin's layout):
`available`, `locked` (temporarily held by someone booking it — `locked_by_me` marks your own,
shown as *selected*), `booked`, `blocked` (crew, reserved, blocked off or beyond the seats for
sale). Signed-in customers also get their own `hold`. Availability is always per trip: the same
bus on another day is unaffected.

**Seat locks** (`/api/v1/seat-locks/`, customers and admins):

| Call | Does |
|------|------|
| `POST {trip, seats}` | Locks the seats — all or none — for `SEAT_LOCK_MINUTES` (default **5**). Each seat must exist, be for sale and not be booked or locked by someone else; otherwise **409 `seats_unavailable`** with `details.seats` = `{"15": "locked"}` (or `booked` / `blocked`). All of a customer's locks on a trip share one countdown, so adding seats never extends it. Max 10 seats per trip. |
| `GET ?trip=` | Your current hold: seats, `expires_at`, `seconds_remaining`, and the server's price `quote` |
| `DELETE {id}` / `POST release {trip, seats?}` | Give seats back |

**Bookings** (`/api/v1/bookings/`): `POST {trip, boarding_stop, dropoff_stop, passengers:
[{seat_number, name, phone, email}]}` turns *your currently locked* seats into a **pending**
booking (409 `hold_expired` if a lock ran out). The booking keeps the lock's expiry
(`expires_at`) as its seat hold, gets a reference such as `YT53CCWVYE`, the journey, one
passenger per seat and the server-calculated price. Then: `PATCH` (fix passenger details while
pending) → `POST checkout` (**payment pending**) → payment → **confirmed** (→ **completed** when
the trip is marked completed). `POST cancel` releases the seats (customers only before paying;
admins any time). Unpaid bookings whose hold runs out become **expired** and free their seats.
`POST confirm` (admin) records a counter payment and confirms the booking; it refuses if the
hold already ran out. Online payments confirm through the same booking-engine hooks
([§16](#16-phase-5-payments--e-tickets)).

Customers only ever see their own bookings (others answer 404); admins see all. Operators have
no access to customer bookings.

**How double booking is prevented** (`apps/bookings/services.py`):

1. Every seat change on a trip — lock, release, book, pay, cancel — runs in one database
   transaction that first row-locks the trip (`SELECT … FOR UPDATE`). Seat changes on one trip
   happen strictly one after another; different trips never wait for each other.
2. PostgreSQL allows **one `SeatLock` per (trip, seat)**.
3. PostgreSQL allows **one seat-holding `Passenger` per (trip, seat)** (a partial unique
   index; cancelled/expired bookings release it).

So of two customers who tap seat 15 at the same instant, exactly one gets the lock and the other
gets a clear 409 — verified with real concurrent requests in `test_concurrency.py`. Locks never
depend on browser state: the page only shows what the server reports.

**Expiry.** An expired lock or unpaid booking stops counting the moment it expires; it's
cleared the next time that trip's seats change, and `python manage.py expire_seat_holds`
sweeps everything (run it every minute from cron / Celery beat in production).

**Price.** `apps/bookings/pricing.py` is the only place totals are calculated:
`ticket price × seats + service fee − discount + tax`. Service fees and tax come from
`BOOKING_SERVICE_FEE_PER_SEAT`, `BOOKING_SERVICE_FEE_PERCENT` and `BOOKING_TAX_PERCENT`
(all 0 by default); discounts plug into `discount_for()`. The booking stores the full
breakdown; anything the client sends is ignored.

Settings: `SEAT_LOCK_MINUTES` (5), `SEAT_LOCK_THROTTLE_RATE` (60/min per account).

---

## 16. Phase 5: payments & e-tickets

**Customer flow**: seat selection → passenger details → **booking review** (`/bookings/{id}`) →
**checkout** (`/bookings/{id}/checkout`) → the gateway's own page → **payment result**
(`/bookings/{id}/payment`) → **e-ticket** (`/bookings/{id}/ticket`).

### The payment layer is pluggable

`apps/payments/providers/` defines one interface — `create_checkout`, `parse_notification`,
`fetch_status`, `refund` — and the booking flow only ever talks to that. Adding a gateway means
writing one subclass and listing its code in `PAYMENT_PROVIDERS`; nothing else changes.

| Provider | What it is |
|----------|------------|
| `payhere` | [PayHere](https://www.payhere.lk) — Visa, Mastercard, Amex, eZ Cash, mCash, Genie, FriMi and online banking. A hashed form is posted to PayHere's hosted checkout; PayHere posts an MD5-signed notification back. Sandbox by default. Status look-ups and API refunds need the optional Business App keys. |
| `mock` | A built-in **test gateway** for development and demos: its own hosted page, HMAC-signed notifications, a status API and refunds — without moving money or asking for card details. Production refuses to start with it enabled. |
| `manual` | Not a gateway: what the admin "confirm" action records for cash at the counter. |

**No card data ever reaches this server.** Customers type their card, wallet or bank details on
the gateway's own page. We store the gateway's own payment id and a whitelisted summary of its
reply (`payment_id`, `status_code`, `method`, amount, currency); PayHere's `card_no`,
`card_holder_name` and `card_expiry` are dropped on arrival. Credentials come from the
environment only — there are none in the repository.

### Only a verified gateway result confirms a booking

The browser coming back to our "success" page proves nothing, so it confirms nothing. A booking
is confirmed only when the gateway tells our server — a signed notification to
`POST /api/v1/payments/webhooks/{provider}/`, or our own status look-up with the gateway.

Idempotency has two layers, so a notification that is delivered twice, retried after an error,
or races a status check can never confirm a booking (or charge a customer) twice:

1. Every result is stored as a `PaymentEvent` with a **unique `(provider, event_id)`**, inside
   the same transaction that applies it. A duplicate is recognised and skipped (still answering
   `200`, so the gateway stops retrying); a delivery that failed half-way rolls back completely
   and is re-processed on the retry.
2. A payment's status only ever moves forward, under a row lock taken trip → booking → payment.
   A late "failed" after a success is ignored; a second success changes nothing.

**Every case is handled and tested** (`apps/payments/tests/`):

| What happens | What the platform does |
|--------------|------------------------|
| Payment succeeds | Confirms the booking, turns the held seats into booked ones, issues the e-ticket |
| Payment fails or is declined | The booking stays payment-pending and the seats stay held, so the customer can try again |
| Customer closes the gateway page | Nothing is confirmed; the hold runs out normally and the seats are released |
| Customer uses the gateway's cancel link | The attempt is cancelled (the browser may only ever cancel, never confirm) |
| Notification is late or never arrives | The payment page asks the server to check with the gateway, and `reconcile_payments` sweeps the rest |
| Notification arrives twice / is retried | Recognised as a duplicate and applied exactly once |
| Payment lands after the hold ran out | The seats are taken back if they're still free; otherwise the payment is flagged **needs refund** |
| The customer pays twice, or pays after a counter payment | The extra payment is flagged **needs refund** |
| The gateway reports a different amount | Refused, flagged for refund, and logged as an error — the booking is never confirmed |
| The trip is cancelled, or staff cancel a paid booking | The payments are flagged **needs refund** |
| A refund is made | Full refunds cancel the booking and release its seats; partial refunds leave it confirmed |

Timings: starting a payment holds the seats for `PAYMENT_WINDOW_MINUTES` (10), never beyond
`PAYMENT_MAX_HOLD_MINUTES` (20) after the booking was made, so nobody can hold seats
indefinitely by starting payments.

### E-tickets

Confirmation issues a `Ticket` (one per booking, e.g. `TKZB6WDYRJRZ`). Its QR code contains
**only the ticket number and a signature** made with the server's secret — no passenger names,
phone numbers or seat details — so a code invented by hand is rejected, and a scan reveals
nothing by itself. Staff scan it at `GET /api/v1/tickets/verify/?code=` (admins any ticket,
operator staff only their own company's trips).

The ticket page shows the booking reference, passengers and seats, route, boarding and drop-off
points, travel date and departure time, bus, amount and status, and offers **Download PDF** (a
ReportLab A4 ticket, fetched with the signed-in session) and **Print** (the site chrome is
hidden). Tickets follow their booking: cancel it and the ticket reads *cancelled*.

### Admin payments

`/admin/payments` lists every attempt with its money collected today and in the last 30 days,
and how many refunds are outstanding; filter by status, gateway, date or "needs refund", or
search by transaction, booking reference, customer name or e-mail. A payment's page shows its
full **timeline** (checkout → notifications → status checks → refunds), the booking and trip it
belongs to, and two actions: **Check with gateway** (asks the gateway what happened now) and
**Refund** (through the gateway's API where it has one, otherwise recording a refund made in the
gateway's portal). Refunds are written to the activity log.

### Trying it end to end (development)

`PAYMENT_PROVIDERS=mock` (the default in debug) puts the test gateway on the checkout page.
Book a seat, press **Pay Now**, and the test gateway offers: pay, decline, cancel, or *pay but
hold back the notification* — which is how you exercise a late notification and watch the
payment page recover through a status check. `python manage.py reconcile_payments` does the
same sweep from cron.

---

## 17. Phase 6: customer account & booking management

**The dashboard** (`/account`) opens on the customer's own trips: their profile, four headline
numbers (upcoming, previous, cancelled, total paid — plus any refund on its way), and their
bookings in four tabs — **Upcoming trips**, **Previous trips**, **Cancelled** and the whole
**Booking history**. Each row carries what you need to recognise a journey: booking reference,
route, date, departure time, seats, status and amount, with the next useful action (E-ticket,
Pay now, or Details). Phones get the same rows as cards; the full table appears from `md` up.

What each tab means is decided once, on the server (`apps/bookings/selectors.py`), so the list,
its filters and the counts can never disagree:

| Tab | Bookings |
|-----|----------|
| Upcoming | Pending, payment-pending or confirmed, and the bus hasn't left yet — soonest first |
| Previous | Completed, or paid with the departure behind them — most recent first |
| Cancelled | Cancelled or expired |

`GET /api/v1/bookings/` also takes `?status=`, `?search=` (reference, route or passenger name)
and `?date_from=` / `?date_to=`, and `GET /api/v1/bookings/summary/` feeds the headline numbers.

**Booking details** (`/bookings/{id}`) show the whole booking: journey with boarding and
drop-off points and times, every passenger with their seat, the server's price breakdown, the
payment (amount, status, when it was paid) and any refund with its progress — plus **View
e-ticket**, **Download ticket**, printing (from the ticket page) and **Cancel booking** when the
policy allows it.

### The cancellation policy is configuration, not code

`apps/bookings/cancellation.py` reads `BOOKING_CANCELLATION` and answers one question for a
booking: *may this be cancelled now, and what comes back?* The browser never decides — it
renders the answer, including the policy wording itself, from
`GET /api/v1/bookings/{id}/cancellation/`:

```json
{ "allowed": true, "refundable": true, "refund_amount": "1875.00", "refund_percent": "75",
  "fee": "0.00", "paid_amount": "2500.00", "deadline": "2026-09-16T14:30:00+05:30",
  "rules": ["48 hours or more before departure: in full", "…"] }
```

Defaults: full refund 48 hours or more before departure, 75% from 24 hours, 50% from 6 hours,
and inside 6 hours only the support team can cancel (they can always step in, and the customer
then gets everything back). Fees and tiers are environment variables (§6) — swap
`CancellationPolicy.current()` for a database-backed policy when admins should edit it, and
nothing else changes.

Cancelling (`POST /api/v1/bookings/{id}/cancel/`) does five things in one transaction: refuses
anything the policy forbids (**409 `cancellation_not_allowed`**, with the same quote in
`details`), marks the booking cancelled, releases its seats for other passengers, records the
time and the customer's reason, and raises a refund request for whatever the policy gives back.

### Refunds are a queue, not a flag

A `Refund` record is raised whenever money is owed: a cancellation under the policy, a trip the
operator cancelled, or a payment that couldn't be used (§16). It moves **requested →
processing → completed | rejected**; completing one actually returns the money through the
payment's gateway (or records a refund the team made in the gateway's portal). The policy
numbers are frozen onto the request when it is raised, so a later rule change can't rewrite
history. Customers follow their own at `/api/v1/refunds/` and on the booking page; the team
works through `/admin/refunds`.

### Profile

`/account/profile` edits name, phone and email — the email is also the sign-in — and changes the
password. Every JWT embeds a hash of the password, so changing it retires every existing token;
the API answers with a fresh session so the customer stays signed in here and is signed out
everywhere else.

### One customer never sees another's booking

Every customer-facing list and detail is scoped to the signed-in account in `get_queryset()`, so
another customer's booking, payment, ticket, refund or cancellation quote simply isn't there —
a **404**, never a 403 that would confirm it exists. `apps/bookings/tests/test_authorization.py`
walks the whole surface (read, cancel, edit, pay, ticket, PDF, refunds) as the wrong customer,
as an operator, as a signed-out visitor and as an admin.

---

## 18. Phase 7: admin bookings, passengers & reporting

The office side of the platform: every booking, everyone travelling, the printed manifest the
crew carries, seven reports, and the dashboard's charts. Everything on this page is counted by
the database — the browser is sent one page of rows and the totals, never the underlying records.

### Bookings

`/admin/bookings` lists every booking on the platform with its reference and booking date,
customer, route and trip, departure, seats, amount (and what has actually been paid), payment
status and booking status. Search covers the reference, the customer, the passengers and the
trip; filters cover status, payment status, trip, route, operator, bus, customer, the days it
was **booked** (`date_from` / `date_to`) and the days people **travel** (`departure_from` /
`departure_to`).

Opening one (`/admin/bookings/{id}`) shows the whole booking — journey, boarding and drop-off
points, every passenger and seat, the customer, the payment, the e-ticket and any refunds — with
**E-ticket** and **Cancel booking**. Cancelling from the office runs the same policy the customer
sees, taken with staff powers (`GET /admin/bookings/{id}/cancellation/`), so support can step in
inside the cut-off but still can't re-cancel something that is already over; the reason is kept
on the booking and written to the activity log.

### Passengers and the manifest

`/admin/passengers` answers "who is on this bus?" by **trip, route, bus, date, booking** or a
search on name, phone or reference. Each line carries the passenger's name and phone, their
booking reference and seat, boarding and drop-off points, payment status and boarding status,
and the crew tick people off as they board (`POST /admin/passengers/{id}/boarding/`). A seat that
went back on sale reads *Not travelling* and can't be boarded.

`/admin/trips/{id}/manifest` is the printable list, in seat order:

```
Trip: Colombo → Batticaloa
Date: 15 Sep 2026   Departure: 8:30 PM   Bus: WP NC-4521

Seat | Passenger        | Phone         | Boarding      | Drop-off    | Booking    | Boarded
15   | Kasuni Fernando  | +94771234567  | Colombo Fort  | Batticaloa  | YTABC23456 | Boarded
```

**Print** uses the browser; **Download PDF** asks the server for the same page
(`/api/v1/admin/trips/{id}/manifest/pdf/`), so a phone in a depot gets the same paper.

### Reports

`/admin/reports` runs seven reports over a chosen period:

| Report | Answers |
|--------|---------|
| Booking | Every booking made (or travelling) — value, seats, status |
| Passenger | Who travelled, on which seat, and whether they boarded |
| Revenue | Gross, refunds and net takings, day by day |
| Route performance | Trips, seats, occupancy and takings per route |
| Bus occupancy | Seats sold ÷ capacity × 100, by trip, route, bus or date |
| Cancellation | What was cancelled, why, what it cost and what was refunded |
| Payment | Every payment attempt, by gateway, and what became of it |

The date filter is shared by all of them — **Today, Yesterday, This week, This month, a custom
range** or all time — as are the route, operator, bus and trip filters. Revenue reports gross,
refunds, net, the number of bookings and the average booking value; occupancy reports seats sold
against capacity and the empty seats left over.

`GET /api/v1/admin/reports/` lists what exists (the screen hard-codes nothing);
`GET /api/v1/admin/reports/{key}/` returns the columns, the totals and one page of rows; and
`GET /api/v1/admin/reports/{key}/export/?format=csv|xlsx|pdf` downloads the lot. CSV streams from
the database cursor, Excel is written row by row, and the PDF is capped at 1,000 rows because it
is meant to be read.

### Dashboard charts

The admin dashboard gained a **Trading** section: daily bookings, daily revenue, occupancy,
cancellations and the best-earning routes, for the period you pick. One request
(`GET /api/v1/admin/dashboard/charts/`) returns every series already aggregated and zero-filled
day by day, and the charts are plain SVG — no charting library, no raw records in the browser.

### Efficiency and authorization

Reports never load a result set into memory: totals are `.aggregate()`, rows are
`.values().annotate()` sliced by the paginator, and exports stream through
`queryset.iterator()`. The booking and passenger lists annotate their columns (seats, paid
amount, latest payment status, boarding state) in SQL, so a page of twenty rows is a handful of
queries however large the tables grow. Every endpoint in this phase is admin-only: customers and
operators get **403**, signed-out visitors **401**, covered by tests in `apps/reports/tests/`.

---

## 19. MVP hardening

The last phase before launch added no features. It went through the MVP looking for the ways it
could break or leak, wrote the checks that would catch each one again, and documented what an
operator needs to run it (see [the guides above](#documentation)).

### The whole flow is one test

`apps/core/tests/test_mvp_flow.py` walks the product over HTTP the way a browser does — search,
trip, stops, seat map, seat lock, passenger details, checkout, the gateway's signed notification,
confirmation, e-ticket PDF, booking history — and then the administrator's path across every
screen the MVP ships. A second test cancels a paid booking and checks the refund appears in the
queue. If the product is broken, these fail.

### The security audit is executable

`apps/core/tests/test_security_audit.py` is the audit as tests, one class per line of it:

| Area | What is asserted |
|------|------------------|
| Authentication | No token, a bogus header and a tampered signature are all 401; changing a password retires every existing token; the refresh token is HttpOnly, path-scoped and never in a response body |
| Authorization | Customers and operators get 403 on all 16 admin endpoints; one customer reading or acting on another's booking gets **404**, never 403 |
| Role permissions | Registration always creates a customer — `role`, `is_staff` and `is_superuser` in the payload are ignored — and nobody can promote themselves through the profile endpoint |
| API surface | Only `v1` is routed, responses are JSON (an HTML-only client gets 406), the browsable API is not served, and the schema is only served when switched on |
| CORS | An allowed origin is echoed with credentials; any other origin is not |
| Rate limiting | Repeated sign-in attempts end in 429 with `retry_after` |
| Input validation | Malformed JSON is 400 not 500, missing fields are reported per field, weak passwords are refused, and the seat limit holds |
| Injection | SQL payloads in public and admin search are treated as text (the ORM parameterises everything; there is no raw SQL) |
| Cross-site scripting | A `<script>` payload round-trips as data through a JSON-only API |
| Sensitive data | No credentials in the user payload, no gateway internals in a customer's payment, the activity log is admin-only |
| Error leakage | An unexpected exception answers with a generic message and a request id — no traceback, no internals — and production settings are verified hardened, including the refusal to start with the test payment gateway |

Booking-specific safety (double booking, racing customers, expired holds, duplicate payment
callbacks, cancellation and refunds) was already covered by `test_concurrency.py`,
`test_payment_concurrency.py`, `test_cancellation.py` and `test_refund_queue.py`.

### Nothing is allowed to be N+1

`apps/core/tests/test_query_counts.py` measures the queries a list costs with one row, then with
five, and fails if the number moved. It covers the admin bookings, passengers, trips and payments
lists, search results, the customer's bookings, the seat map, all seven reports and the dashboard
charts. Three indexes were added for the reporting queries Phase 7 introduced:
`bookings_recent_idx`, `bookings_cancelled_at_idx` and `payments_status_paid_idx`.

### Structured logging

`apps/core/logging.py` gained `log_event`, and the events an operator needs are now emitted as
structured lines on the `apps.events` logger — JSON in production, each stamped with the request
id that also appears in the `X-Request-ID` header:

```
auth.login · auth.login_failed · auth.logout · auth.refreshed · auth.refresh_rejected
auth.registered · auth.profile_updated · auth.password_changed
seat.locked · booking.created · booking.checkout · booking.confirmed · booking.cancelled
payment.started · payment.captured · payment.recorded · payment.checkout_failed
payment.amount_mismatch · refund.status_changed · admin.action
```

A failed sign-in records the email and the caller's address but never the password; `X-Forwarded-For`
is only believed when `TRUST_PROXY_HEADERS` says the deployment sits behind a proxy that sets it.
`apps/core/tests/test_event_logging.py` asserts each event fires with the right fields.

### Four environments, not two

`config/settings/staging.py` joins development, test and production: production's hardening —
HTTPS, HSTS, secure cookies, WhiteNoise — plus the test payment gateway and the API documentation,
with a short HSTS window so a staging domain is never pinned for months.

### Frontend

The web container now sends a **Content-Security-Policy**: scripts and styles only from the app
itself, no plugins, no framing, no rewritten `<base>`, and API calls only to
`NEXT_PUBLIC_API_URL`. It stays deliberately modest — Next.js inlines its own bootstrap script, so
`'unsafe-inline'` remains until a nonce middleware is worth the request cost — and
`upgrade-insecure-requests` only appears once the API is actually on HTTPS.

The admin console gained the **skip link** the public site already had (both now share one
component), and two test files close the gaps that mattered: `src/lib/auth/session.test.ts` proves
the access token never reaches storage, a reload restores the session from the HttpOnly cookie,
concurrent refreshes share one request and signing out in one tab signs out the others;
`src/components/auth/auth-flow.test.tsx` covers sign-in validation, the server's error messages, a
network failure, and the route guard — loading, expired (with `?next=`), deliberate sign-out, the
wrong role and the right one.

---

## 20. Route maps

Every trip and every route now has an interactive map: the origin, each intermediate stop, the
destination, and the line between them in travel order — with the traveller's own boarding and
drop-off points picked out. Full detail in [docs/route-maps.md](docs/route-maps.md).

**Leaflet 1.9 + react-leaflet 5 + OpenStreetMap.** The tile server is configuration
(`NEXT_PUBLIC_MAP_TILE_URL`), so moving to a provider or a self-hosted server later is two
environment variables and the tile host in the Content-Security-Policy. The line follows the
road: OSRM (OpenStreetMap's routing engine) is asked once per route on the server and the
geometry is cached on the route; with no stored road the map draws a dashed line and says so.

**No new endpoint and no extra request.** `Stop` already stored `latitude` / `longitude`
(nullable, both-or-neither, range-checked), and the trip and route endpoints already returned
stops in sequence with their times. Adding the two coordinate fields to the stop payload gave
the map everything it needs — the customer's trip page draws its map from data it had already
fetched.

**Where it appears**

| Screen | What it does |
|--------|--------------|
| `/trips/{id}` | "Route map" card; tap a stop for its times, or to board / get off there |
| `/admin/routes/new`, `/admin/routes/{id}/edit` | Live preview that redraws as stops are added, removed or reordered |
| `/admin/routes/{id}` | The saved route beside its timetable |
| Stop form | **Pick on map** fills in latitude and longitude; typing them moves the marker |

**The parts that are easy to get wrong**

- Choosing a stop from the map is driven by the server's own `boarding_points` and
  `dropoff_points`, so the map can never offer a journey the API would refuse.
- A stop without coordinates is not dropped silently: the line skips it and a note names it.
  When nothing on a route is mapped, the panel says so rather than showing an empty rectangle.
- Leaflet loads through `next/dynamic` with `ssr: false` — it reads `window` on import, and this
  also keeps its ~150 KB chunk off every page that has no map.
- The stop list beside the map is the accessible equivalent; maps are `print:hidden`.
- The tile host is added to `img-src` in `next.config.ts`, derived from the tile URL. Without
  that the CSP would block every tile and leave a blank grey map.

**Prepared, not built:** `RouteMap` accepts a `busLocation` and draws a vehicle marker. Nothing
supplies one yet — live GPS tracking is a later phase, and the remaining questions there are
about transport and who writes positions, not about the map.

---

## 21. Launch pack: tickets by text, phone sign-in, operator portal

Three things every competitor already offers, built so they are easier here.

### Tickets by SMS and e-mail

When a booking is paid, every phone number on it gets a text with the booking reference, where and
when to board, the seats, the bus's number plate and the ticket's own link; every e-mail address
gets the same with the PDF attached. A reminder text follows `TRIP_REMINDER_HOURS` (3) before
boarding. The link (`/t/<code>`, 128 random bits) opens without an account — it shows the journey
and the QR code, nothing private — so it works for whoever is actually travelling. Lost the text?
**Find my booking** (`/find-booking`) texts it again, but only to a phone already on the booking.

Messages are written in the same transaction that confirms the booking (so a duplicate payment
notification sends one ticket, and nothing is sent for a change that rolled back), sent in the
background the moment it commits, and retried by `send_notifications` (run it every minute). SMS
goes through Notify.lk; e-mail through any SMTP service. → [docs/notifications.md](docs/notifications.md)

### Book with just a phone number

Tap a seat while signed out and the seat map asks for a mobile number, texts a six-digit code, and
holds the seat you tapped as soon as the code is accepted. A new number becomes a customer account
on the spot — no password, no e-mail (passenger e-mail is now optional everywhere). Codes are
hashed, single-use, five minutes, five guesses; one a minute and five an hour per phone. Staff
never sign in by SMS, and a number already on a password account is linked only after one password
sign-in. → [docs/phone-sign-in.md](docs/phone-sign-in.md)

### The operator portal

`/operator` now shows a company its day (trips, passengers, boarded, bookings paid, takings), its
trips with seats sold, each trip's stops and bookings, the printable manifest, every booking with
tap-to-call passenger numbers, and a revenue report by day or by route with CSV/Excel/PDF. Owners
and managers see money; staff see trips and people. Every query starts from the operator's own
company, so another company's records are simply not found. → [docs/operator-portal.md](docs/operator-portal.md)

### Verified

* Backend: 126 new tests (932 in all) — ticket delivery, duplicates, retries and claims,
  reminders, link privacy, Find my booking, Notify.lk request/refusal handling, the whole code
  flow and its limits, password-account linking, phone-only booking and PayHere checkout, and the
  portal's permissions, company isolation, numbers and query budgets.
* Frontend: 27 new tests (277 in all) — phone sign-in, the login tabs and phone linking, the seat
  map's inline sign-in, optional e-mail, the shared ticket and Find my booking, the operator gate,
  dashboard, trips, booking detail and revenue.
* Live against the dev servers: 49 end-to-end checks, from texting a code to downloading the
  operator's route report.
