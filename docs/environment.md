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
| `TRUST_PROXY_HEADERS` | `false` | no | Believe `X-Forwarded-For` when logging the caller's address. Only behind a proxy that overwrites it. |

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

## Rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `THROTTLE_RATE_ANON` | `120/min` | Per IP, signed-out. |
| `THROTTLE_RATE_USER` | `600/min` | Per account. |
| `THROTTLE_RATE_AUTH` | `10/min` | Sign-in, registration and password change. |

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
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` | API base URL including the version. Also becomes the `connect-src` of the Content-Security-Policy. |
| `NEXT_PUBLIC_APP_NAME` | `Yathra` | Product name in the interface. |

## Docker Compose

`.env` at the repository root feeds `docker-compose.yml`: `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD` (**secret**), `POSTGRES_PORT`, `REDIS_PORT`, plus the backend and frontend
variables above.
