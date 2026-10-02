# API reference

Base URL: `{PUBLIC_API_URL}/api/v1/`. Every route is versioned; `v1` is the only version served.
JSON in, JSON out — there is no HTML renderer, so an HTML-only client gets a `406`.

An OpenAPI schema is generated from the code itself: `/api/schema/` (and Swagger UI at
`/api/docs/`) when `API_DOCS_ENABLED=true`. That schema, not this page, is the exhaustive
contract; this page is the map.

---

## Authenticating

Sign in returns a short-lived **access token** in the body and sets a long-lived **refresh
token** as an `HttpOnly` cookie scoped to `/api/v1/auth/`. JavaScript never sees the refresh
token; the access token is held in memory and sent as `Authorization: Bearer <token>`.

```http
POST /api/v1/auth/login/
{"email": "customer@yathra.test", "password": "…"}

200 {"access": "eyJ…", "user": {"id": "…", "name": "…", "role": "customer", …}}
Set-Cookie: yathra_refresh=…; HttpOnly; Path=/api/v1/auth/; SameSite=Lax
```

When the access token expires, `POST /api/v1/auth/refresh/` (with the cookie) issues a new one
and rotates the refresh token. Changing a password invalidates every existing token immediately.

## Roles

| Role | Sees |
|------|------|
| *(anonymous)* | Search, trips, stops, routes, seat maps, ticket verification |
| `customer` | Their own bookings, payments, refunds, tickets and profile |
| `operator` | Their own company profile (self-service arrives in a later phase) |
| `admin` | Everything under `/api/v1/admin/` plus every booking and payment |

A customer asking for another customer's record gets **404**, not 403 — the API never confirms
that someone else's booking exists.

## Errors

Every failure has the same shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Please correct the highlighted fields.",
    "details": {"seats": ["Seat 15 is already booked."]},
    "request_id": "3f2a9c…"
  }
}
```

| Status | When |
|--------|------|
| 400 | Validation failed; `details` is keyed by field |
| 401 | No token, or it expired |
| 403 | Signed in, wrong role |
| 404 | Not found — or not yours |
| 409 | Conflicts with current state: seats taken, hold expired, cancellation not allowed |
| 429 | Throttled; `details.retry_after` is in seconds |
| 500 | A bug. The message is generic; `request_id` ties it to the server log |

Every response carries an `X-Request-ID` header, echoed from the request when you send one.

## Lists

Paginated lists answer with `{count, page, total_pages, next, previous, results}`. They accept
`?page=`, `?page_size=` (max 100), `?search=` and `?ordering=`; the filters each list supports are
in the schema.

---

## Public

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health/` | Readiness: database and cache (`503` if either is down) |
| GET | `/health/live/` | Liveness: the process answers; checks nothing else |
| GET | `/trips/search/` | Search trips: `from`, `to`, `date`, plus filters and sorting |
| GET | `/trips/{id}/` | One trip |
| GET | `/trips/{id}/stops/` | Boarding and drop-off points, with times |
| GET | `/trips/{id}/seats/` | Seat map; includes your own hold when signed in |
| GET | `/routes/`, `/routes/{id}/` | Routes |
| GET | `/stops/`, `/stops/{id}/` | Stops |
| GET | `/tickets/verify/` | Verify a ticket QR code (admin / operator) |
| GET | `/tickets/shared/{code}/`, `/tickets/shared/{code}/pdf/` | The ticket behind a link from a ticket SMS or e-mail — no session needed |
| POST | `/tickets/find/` | "Find my booking": `reference` + a `phone` on the booking; texts the ticket to that phone. Always 202 |
| GET | `/payments/providers/` | Gateways on offer |

## Account

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/register/` | Create a customer account and sign in |
| POST | `/auth/login/` | Sign in (any role). Optional `phone_proof` links a phone proven by a code |
| POST | `/auth/phone/code/` | Text a six-digit sign-in code (customers) — see [phone-sign-in.md](phone-sign-in.md) |
| POST | `/auth/phone/verify/` | Sign in with the code; creates the account for a new number (201) |
| POST | `/auth/refresh/` | Exchange the refresh cookie for a new access token |
| POST | `/auth/logout/` | Blacklist the refresh token and clear the cookie |
| GET / PATCH | `/auth/me/` | Read or update your own name, phone and email |
| POST | `/auth/password/` | Change your password; returns a fresh session |

## Booking (customer)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/seat-locks/?trip=` | Your current hold on a trip |
| POST | `/seat-locks/` | Hold seats (all or none) for `SEAT_LOCK_MINUTES` |
| DELETE | `/seat-locks/{id}/` | Release one seat |
| POST | `/seat-locks/release/` | Release several, or all, on a trip |
| GET | `/bookings/` | Your bookings; `?scope=upcoming\|past\|cancelled`, `?search=`, `?status=` |
| GET | `/bookings/summary/` | Counts and totals for the dashboard |
| POST | `/bookings/` | Turn your held seats into a booking (passenger details) |
| GET | `/bookings/{id}/` | One booking, in full |
| PATCH | `/bookings/{id}/` | Correct passenger details |
| POST | `/bookings/{id}/checkout/` | Confirm the review; the booking now awaits payment |
| GET | `/bookings/{id}/cancellation/` | May this be cancelled, and what comes back? |
| POST | `/bookings/{id}/cancel/` | Cancel under the policy |
| GET | `/bookings/{id}/ticket/` | The e-ticket, with its QR code |
| GET | `/bookings/{id}/ticket/pdf/` | The e-ticket as a PDF |

## Payments (customer)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/payments/` | Start a payment; returns the gateway's hosted checkout |
| GET | `/payments/`, `/payments/{id}/` | Your payment attempts |
| POST | `/payments/{id}/verify/` | Ask us to check with the gateway now |
| POST | `/payments/{id}/cancel/` | You came back through the gateway's cancel link |
| GET | `/refunds/`, `/refunds/{id}/` | Money owed back to you |
| POST | `/payments/webhooks/{provider}/` | **The gateway posts here.** Signed; this is what confirms a booking |

A booking is only ever confirmed by a verified gateway result — never because the browser
returned to a success page.

## Administration (`admin` role)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/dashboard/` | Headline numbers and recent activity |
| GET | `/admin/dashboard/charts/` | Daily bookings, revenue, occupancy, cancellations, top routes |
| CRUD | `/admin/operators/`, `/admin/buses/`, `/admin/seat-layouts/`, `/admin/routes/`, `/admin/stops/` | Reference data; each has `activate/` and `deactivate/` |
| POST | `/admin/seat-layouts/generate/` | Build a layout from rows and columns |
| CRUD | `/admin/trips/` | Trips, plus `cancel/`, `status/`, `reset-timings/` |
| GET | `/admin/trips/{id}/manifest/` and `/manifest/pdf/` | The crew's passenger list |
| CRUD | `/admin/trip-schedules/` | Recurring timetables, plus `generate/` |
| GET | `/admin/bookings/`, `/admin/bookings/{id}/` | Every booking; search and filters |
| GET / POST | `/admin/bookings/{id}/cancellation/`, `/cancel/` | Cancel for a customer |
| GET | `/admin/passengers/` | Who is travelling — by trip, route, bus, date or booking |
| POST | `/admin/passengers/{id}/boarding/` | Check a passenger onto the bus |
| GET | `/admin/payments/`, `/admin/payments/{id}/`, `/summary/` | Payments |
| POST | `/admin/payments/{id}/refund/`, `/reconcile/` | Refund, or re-check with the gateway |
| GET / POST | `/admin/refunds/`, `/admin/refunds/{id}/status/` | The refund queue |
| GET | `/admin/activity/` | The audit log |
| GET | `/admin/reports/` | What reports exist, and the filters they share |
| GET | `/admin/reports/{key}/` | Run one: `bookings`, `passengers`, `revenue`, `routes`, `occupancy`, `cancellations`, `payments` |
| GET | `/admin/reports/{key}/export/?format=csv\|xlsx\|pdf` | Download it |

Reports share one date filter — `?range=today\|yesterday\|week\|month\|custom\|all` with
`date_from` / `date_to` for a custom span — plus `route`, `operator`, `bus` and `trip`.

## Operator portal (`operator` role, approved company)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/operator/profile/` | Your company and role |
| GET | `/operator/dashboard/` | Today, next departures, takings (owners and managers) |
| GET | `/operator/trips/`, `/operator/trips/{id}/` | Your trips with seats sold and boarded |
| GET | `/operator/trips/{id}/manifest/`, `/manifest/pdf/` | The manifest |
| GET | `/operator/bookings/`, `/operator/bookings/{id}/` | Bookings on your trips |
| GET | `/operator/reports/{revenue\|routes}/`, `/export/` | Takings, owners and managers only |

Everything is limited to your company — see [operator-portal.md](operator-portal.md).

## Rate limits

| Scope | Default |
|-------|---------|
| Anonymous | 120 requests/minute per IP |
| Signed in | 600 requests/minute per account |
| Sign-in, registration, password change | 10/minute |
| Sign-in codes | 5/minute per IP; 1/minute and 5/hour per phone |
| Checking a sign-in code | 10/minute per IP; 5 guesses per code |
| Find my booking | 5/minute per IP |
| Shared ticket links | 60/minute per IP |
| Seat locking | 60/minute per account |
| Payment verification | 20/minute |

---

## A booking, end to end

```bash
TOKEN=$(curl -s -X POST localhost:8000/api/v1/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@yathra.test","password":"Yathra@Dev2026"}' | jq -r .access)

# 1. Find a trip
curl -s "localhost:8000/api/v1/trips/search/?from=Colombo&to=Kandy&date=2026-09-20" | jq '.results[0]'

# 2. Hold two seats
curl -s -X POST localhost:8000/api/v1/seat-locks/ -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"trip":"<trip-id>","seats":["15","16"]}'

# 3. Book them, 4. check out, 5. pay, 6. collect the e-ticket
curl -s -X POST localhost:8000/api/v1/bookings/ -H "Authorization: Bearer $TOKEN" …
curl -s -X POST localhost:8000/api/v1/bookings/<id>/checkout/ -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:8000/api/v1/payments/ -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"booking":"<id>","provider":"mock"}'
curl -s localhost:8000/api/v1/bookings/<id>/ticket/ -H "Authorization: Bearer $TOKEN"
```

`apps/core/tests/test_mvp_flow.py` walks exactly this path on every test run.
