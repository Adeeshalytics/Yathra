# Environment variables

Every deployment-specific value is read from the environment. Nothing secret is ever committed:
`.env`, `backend/.env` and `frontend/.env.local` are git-ignored, and only the `*.env.example`
files (with placeholder values) are in the repository.

**Never commit:** `DJANGO_SECRET_KEY`, `JWT_SIGNING_KEY`, `POSTGRES_PASSWORD`, `DATABASE_URL`
with a real password, `PAYHERE_MERCHANT_SECRET`, `PAYHERE_APP_SECRET`, `MOCK_PAYMENT_SECRET`.
Keep them in your platform's secret store (Docker secrets, AWS Secrets Manager, Fly secrets,
GitHub Actions secrets) and inject them as environment variables at run time.

Which settings module reads them is chosen by `DJANGO_SETTINGS_MODULE`:

| Environment | Module | Notes |
|-------------|--------|-------|
| Development | `config.settings.development` | `DEBUG=True`, test gateway allowed, docs on |
| Test | `config.settings.test` | Used by pytest; throttling effectively off, fast hashing |
| Staging | `config.settings.staging` | Production hardening + test gateway + API docs |
| Production | `config.settings.production` | HTTPS, HSTS, secure cookies, refuses the test gateway |

---

## Core

| Variable | Default | Required | Description |
|----------|---------|:--------:|-------------|
| `DJANGO_SECRET_KEY` | — | **yes** | Signs sessions and (by default) JWTs. **Secret.** |
| `DJANGO_DEBUG` | `false` | no | Never `true` outside development. |
| `DJANGO_ALLOWED_HOSTS` | empty | **yes in prod** | Comma-separated host names the API answers on. |
| `DJANGO_ADMIN_URL` | `django-admin/` | no | Where the Django admin is mounted. Change it in production. |
| `APP_NAME` | `Yathra` | no | Shown in the Django admin and used in file names. |
| `TRUSTED_PROXY_COUNT` | `0` | **yes behind a proxy** | How many reverse proxies append to `X-Forwarded-For` in front of the app. The caller is the entry the outermost one appended; everything left of it is client-supplied and ignored. Used for rate limiting and the security log. `0` uses the connection's address. Behind the Kubernetes ingress: `1`. |
| `TRUST_PROXY_HEADERS` | `false` | no | Older switch: `true` means `TRUSTED_PROXY_COUNT=1`. |

## Data stores

| Variable | Default | Required | Description |
|----------|---------|:--------:|-------------|
| `DATABASE_URL` | — | **yes** | e.g. `postgres://user:pass@host:5432/yathra`. **Secret.** |
| `DB_CONN_MAX_AGE` | `60` | no | Seconds a database connection is reused. |
| `REDIS_URL` | empty | no | Cache and throttle counters. Falls back to in-process memory (single worker only). |

## Browser access

| Variable | Default | Required | Description |
|----------|---------|:--------:|-------------|
| `CORS_ALLOWED_ORIGINS` | empty | **yes** | Exact origins of the web app, comma-separated. |
| `CSRF_TRUSTED_ORIGINS` | empty | **yes** | Same list; needed for the Django admin behind HTTPS. |

## Authentication

| Variable | Default | Required | Description |
|----------|---------|:--------:|-------------|
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | `15` | no | Short by design; the app refreshes silently. |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | `7` | no | How long a signed-in session survives. |
| `JWT_SIGNING_KEY` | `DJANGO_SECRET_KEY` | no | Set it to rotate JWT signing separately. **Secret.** |
| `JWT_REFRESH_COOKIE_NAME` | `yathra_refresh` | no | Name of the HttpOnly refresh cookie. |
| `JWT_REFRESH_COOKIE_DOMAIN` | unset | no | e.g. `.yathra.lk` so `app.` and `api.` share it. |
| `JWT_REFRESH_COOKIE_SECURE` | `true` | no | `false` only for plain-HTTP local development. |
| `JWT_REFRESH_COOKIE_SAMESITE` | `Lax` | no | Keep `Lax` for sibling subdomains. |

## Booking rules

| Variable | Default | Description |
|----------|---------|-------------|
| `SEAT_LOCK_MINUTES` | `5` | How long selected seats are held. |
| `SEAT_LOCK_THROTTLE_RATE` | `60/min` | Per-account limit on seat-lock requests. |
| `BOOKING_REFERENCE_PREFIX` | `YT` | First characters of every booking reference. |
| `BOOKING_SERVICE_FEE_PER_SEAT` | `0` | Flat fee added per seat. |
| `BOOKING_SERVICE_FEE_PERCENT` | `0` | Percentage fee on the subtotal. |
| `BOOKING_TAX_PERCENT` | `0` | Tax on the subtotal. |
| `BOOKING_CANCELLATION_TIERS` | `48:100,24:75,6:50` | `hours:percent` refunded, most generous first. |
| `BOOKING_CANCELLATION_CUTOFF_HOURS` | `6` | Inside this, only staff may cancel. |
| `BOOKING_CANCELLATION_FEE_PER_BOOKING` | `0` | Flat fee kept from every refund. |
| `BOOKING_CANCELLATION_FEE_PERCENT` | `0` | Percentage kept from every refund. |

## Payments

| Variable | Default | Required | Description |
|----------|---------|:--------:|-------------|
| `PAYMENT_PROVIDERS` | `mock` in debug, else empty | **yes** | Gateways offered, in order: `payhere`, `mock`. Production refuses `mock`. |
| `PAYMENT_DEFAULT_PROVIDER` | first in the list | no | Which one is pre-selected. |
| `FRONTEND_URL` | `http://localhost:3000` | **yes** | Where gateways send customers back to. |
| `PUBLIC_API_URL` | `http://localhost:8000` | **yes** | Public address gateways post notifications to. Must be reachable from the internet. |
| `PAYMENT_WINDOW_MINUTES` | `10` | no | Seats held once payment starts. |
| `PAYMENT_MAX_HOLD_MINUTES` | `20` | no | Absolute cap on a booking's hold. |
| `PAYMENT_TIMEOUT_MINUTES` | `30` | no | When an unreported attempt is given up. |
| `PAYMENT_VERIFY_THROTTLE_RATE` | `20/min` | no | Limit on "check my payment" polling. |
| `MOCK_PAYMENT_SECRET` | derived from secret key | no | Signs the test gateway's notifications. **Secret.** |
| `PAYHERE_MERCHANT_ID` | empty | for PayHere | Merchant id. |
| `PAYHERE_MERCHANT_SECRET` | empty | for PayHere | **Secret.** Verifies notification signatures. |
| `PAYHERE_SANDBOX` | `true` | no | `false` for live money. |
| `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET` | empty | no | Business App keys: enable status look-ups and API refunds. **Secret.** |
| `ALLOW_MOCK_PAYMENTS` | `false` | no | Lets a production-settings deployment keep the test gateway (staging sets this itself). |
| `PAYMENT_FALLBACK_EMAIL` | `payments@yathra.lk` | no | E-mail given to PayHere's checkout for customers who booked with only a phone number. |

## Text messages and e-mail

Tickets, departure reminders and sign-in codes — see [notifications.md](notifications.md) and
[phone-sign-in.md](phone-sign-in.md).

| Variable | Default | Required | Description |
|----------|---------|:--------:|-------------|
| `SMS_BACKEND` | `console` in debug, else empty | **yes for launch** | `notifylk`, `console` (writes texts to the log; production refuses it) or empty (texts off, phone sign-in unavailable). |
| `SMS_SENDER_ID` | `NotifyDEMO` | for Notify.lk | Your approved sender name. Never send sign-in codes from the demo sender. |
| `NOTIFYLK_USER_ID` | empty | for Notify.lk | From the Notify.lk settings page. |
| `NOTIFYLK_API_KEY` | empty | for Notify.lk | **Secret.** |
| `SMS_TIMEOUT_SECONDS` | `10` | no | How long to wait for the gateway. |
| `ALLOW_CONSOLE_SMS` | `false` | no | Lets a production-settings deployment log texts instead of sending them (staging sets this itself). |
| `EMAIL_URL` | `consolemail://` in debug, else `dummymail://` | **yes for launch** | e.g. `smtp+tls://user:pass@smtp.example.com:587`. `dummymail://` switches e-mail off. **Secret.** |
| `DEFAULT_FROM_EMAIL` | `Yathra <tickets@yathra.lk>` | no | Sender of ticket e-mails; use a domain with SPF and DKIM. |
| `NOTIFICATION_DELIVERY` | `thread` | no | `thread`: send in the background as soon as a booking is paid; `worker`: leave all sending to `send_notifications`. |
| `TRIP_REMINDER_HOURS` | `3` | no | Reminder text this many hours before boarding; `0` switches reminders off. |
| `NOTIFICATION_MAX_ATTEMPTS` | `5` | no | Tries before a message is marked failed. |
| `PHONE_CODE_TTL_MINUTES` | `5` | no | How long a sign-in code works. |
| `PHONE_CODE_MAX_ATTEMPTS` | `5` | no | Wrong guesses before a code locks. |
| `PHONE_CODE_RESEND_SECONDS` | `60` | no | Wait before another code can be sent to the same phone. |
| `PHONE_CODE_MAX_PER_HOUR` | `5` | no | Codes per phone per hour. |

## Road routing

The map draws the road a bus drives. It is worked out once per route on the server and cached,
so the browser never contacts this service — see [route-maps.md](route-maps.md).

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTING_SERVICE_URL` | `https://router.project-osrm.org` | Anything speaking the OSRM protocol. The public demo is development-only; self-host for production. Empty disables routing, and maps fall back to dashed straight lines. |
| `ROUTING_SERVICE_PROFILE` | `driving` | The OSRM profile to ask for. |
| `ROUTING_SERVICE_TIMEOUT_SECONDS` | `8` | How long to wait before giving up (and trying again later). |

## Rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `THROTTLE_RATE_ANON` | `120/min` | Per IP, signed-out. |
| `THROTTLE_RATE_USER` | `600/min` | Per account. |
| `THROTTLE_RATE_AUTH` | `10/min` | Sign-in, registration and password change. |
| `THROTTLE_RATE_PHONE_CODE` | `5/min` | Asking for a sign-in code, per IP. |
| `THROTTLE_RATE_PHONE_VERIFY` | `10/min` | Checking a sign-in code, per IP. |
| `THROTTLE_RATE_TICKET_LINK` | `60/min` | Opening shared ticket links, per IP. |
| `THROTTLE_RATE_TICKET_FIND` | `5/min` | "Find my booking", per IP. |

## Logging and documentation

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGO_LOG_LEVEL` | `INFO` | Root log level. |
| `DJANGO_LOG_FORMAT` | `console` | `json` for log shipping in production. |
| `API_DOCS_ENABLED` | `false` (`true` on staging) | Serves `/api/schema/` and `/api/docs/`. |

## Production-only transport settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGO_SECURE_SSL_REDIRECT` | `true` | Redirect HTTP to HTTPS (health check exempt). |
| `DJANGO_SECURE_HSTS_SECONDS` | `2592000` (30 days) | `60` on staging. |
| `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` | `true` | |
| `DJANGO_SECURE_HSTS_PRELOAD` | `false` | Only once you are sure. |

## Frontend

`NEXT_PUBLIC_*` values are **embedded in the browser bundle** — they are public by definition and
must never hold a secret.

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` in development, `/api/v1` in the Docker image | API base including the version: an absolute URL (API on another host; its origin becomes the CSP `connect-src`) or a path on the same site (API routed under `/api` by the ingress — one image works on any domain). |
| `NEXT_PUBLIC_APP_NAME` | `Yathra` | Product name in the interface. |
| `NEXT_PUBLIC_MAP_TILE_URL` | OpenStreetMap | Leaflet tile URL. Its host must also be allowed by the CSP in `next.config.ts` (which derives it from this value). |
| `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` | OpenStreetMap credit | Shown on every map. Required by the tile licence — see [route-maps.md](route-maps.md). |

## Docker Compose

`.env` at the repository root feeds `docker-compose.yml`: `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD` (**secret**), `POSTGRES_PORT`, `REDIS_PORT`, plus the backend and frontend
variables above.
