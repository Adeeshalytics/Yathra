# Deployment

Two containers (Django + Next.js), a Postgres database and a Redis instance. Nothing else is
stateful; the database is the only thing that must be backed up.

---

## 1. Build the images

```bash
# API — gunicorn, WhiteNoise, collected static files
docker build --target production -t yathra-backend:$(git rev-parse --short HEAD) ./backend

# Web — Next.js standalone server. The API URL is baked into the browser bundle at build time.
docker build --target production \
  --build-arg NEXT_PUBLIC_API_URL=https://api.yathra.lk/api/v1 \
  -t yathra-frontend:$(git rev-parse --short HEAD) ./frontend
```

Because `NEXT_PUBLIC_API_URL` is compiled in, a different API address means a different image.

## 2. Configure

Set `DJANGO_SETTINGS_MODULE=config.settings.production` (or `…staging`) and supply the variables
in [environment.md](environment.md). Secrets come from your platform's secret store — never from
a file in the image.

The minimum for production:

```
DJANGO_SETTINGS_MODULE=config.settings.production
DJANGO_SECRET_KEY=…                      # secret
DJANGO_ALLOWED_HOSTS=api.yathra.lk
DATABASE_URL=postgres://…                # secret
REDIS_URL=redis://…
CORS_ALLOWED_ORIGINS=https://yathra.lk
CSRF_TRUSTED_ORIGINS=https://yathra.lk
FRONTEND_URL=https://yathra.lk
PUBLIC_API_URL=https://api.yathra.lk
PAYMENT_PROVIDERS=payhere
PAYHERE_MERCHANT_ID=…                    # secret
PAYHERE_MERCHANT_SECRET=…                # secret
PAYHERE_SANDBOX=false
JWT_REFRESH_COOKIE_DOMAIN=.yathra.lk
DJANGO_LOG_FORMAT=json
TRUST_PROXY_HEADERS=true
```

Serve the app and API as **sibling subdomains** (`yathra.lk` and `api.yathra.lk`) so the refresh
cookie stays same-site with `SameSite=Lax`.

Production settings refuse to start with the test payment gateway enabled. Staging allows it.

## 3. Release

```bash
# 1. Migrate first — migrations are additive, so the old code keeps working
docker run --rm --env-file prod.env yathra-backend:<sha> python manage.py migrate

# 2. Roll the containers
#    (swap images / update the deployment / restart the service)

# 3. Check
curl -fsS https://api.yathra.lk/api/v1/health/
```

`/api/v1/health/` reports the database and cache and answers `503` if either is down. Point the
load balancer's health check at it; it is exempt from the HTTPS redirect so a plain-HTTP probe
still works.

## 4. Scheduled jobs

Three commands must run on a timer (cron, Kubernetes CronJob, or a scheduler add-on):

| Command | How often | Why |
|---------|-----------|-----|
| `python manage.py expire_seat_holds` | every minute | Puts seats from abandoned checkouts back on sale |
| `python manage.py reconcile_payments` | every few minutes | Asks gateways about attempts whose notification never arrived |
| `python manage.py send_notifications` | every minute | Sends departure reminders, and retries any ticket text or e-mail that didn't go through |

None is required for correctness — expired holds are also swept whenever a seat map is read, and
tickets are sent the moment a booking is paid — but without them seats free up late, a lost
notification stays lost, a failed text is never retried and nobody is reminded.

### Text messages and e-mail

Before launch, set `SMS_BACKEND=notifylk` with an **approved sender ID** and `EMAIL_URL` to a real
SMTP service ([notifications.md](notifications.md)). Production refuses to start with the console
SMS backend. With SMS switched off, tickets aren't texted and customers can't sign in with their
phone number.

## 5. Gateway configuration

In the PayHere merchant portal, set the notification URL to:

```
https://api.yathra.lk/api/v1/payments/webhooks/payhere/
```

It must be reachable from the internet: that notification, not the customer's browser, is what
confirms a booking. Signatures are verified on arrival and every notification is recorded, so a
retry or a duplicate is applied exactly once.

## 6. What production turns on

Set by `config/settings/production.py`, no action needed:

- `DEBUG=False`, HTTPS redirect (health check exempt), HSTS with subdomains
- `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `X-Frame-Options: DENY`, nosniff, strict
  referrer policy
- WhiteNoise serving hashed static files for the Django admin
- JSON logs when `DJANGO_LOG_FORMAT=json`

The web container adds its own headers (`next.config.ts`): a Content-Security-Policy that allows
scripts and styles only from the app itself, blocks framing and plugins, and permits API calls
only to `NEXT_PUBLIC_API_URL`.

## 7. Before you go live

- [ ] `DJANGO_SECRET_KEY` and `JWT_SIGNING_KEY` are fresh, random and stored as secrets
- [ ] `DJANGO_DEBUG` is false and `DJANGO_ALLOWED_HOSTS` lists only your hosts
- [ ] `DJANGO_ADMIN_URL` changed from the default
- [ ] `PAYMENT_PROVIDERS` does not contain `mock`; `PAYHERE_SANDBOX=false`
- [ ] `API_DOCS_ENABLED` is false
- [ ] TLS terminates in front of both containers; `SECURE_PROXY_SSL_HEADER` matches your proxy
- [ ] Database backups are on, and a restore has been tested
- [ ] The two scheduled jobs are running
- [ ] The gateway's notification URL points at the public API
- [ ] Logs ship somewhere you can search by `request_id`
- [ ] An administrator account exists (`createsuperuser`) and the demo seed has **not** been run

## 8. Rolling back

Images are immutable and tagged by commit, so a rollback is redeploying the previous tag. Only
roll the database back if the release contained a destructive migration — this MVP's migrations
are additive, so the previous image runs happily against the newer schema.
