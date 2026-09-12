# Database

PostgreSQL 17. Every table uses a UUID primary key, `created_at` / `updated_at` timestamps, and
lives behind a Django model — there is no raw SQL anywhere in the application.

---

## Schema overview

```
accounts_user ──┬─< operators_operatormembership >── operators_operator ──< fleet_bus
                │                                                              │
                ├─< bookings_booking >── trips_trip ───────────────────────────┘
                │         │                 │
                │         │                 ├── routes_route ──< routes_routestop >── routes_stop
                │         │                 └──< trips_tripstop >── routes_stop
                │         ├──< bookings_passenger
                │         ├──< payments_payment ──< payments_paymentevent
                │         ├──< payments_refund
                │         └──── tickets_ticket (1:1)
                ├─< bookings_seatlock >── trips_trip
                └─< audit_activitylog
```

| App | Model | What it holds |
|-----|-------|---------------|
| accounts | `User` | One account per person; `role` is `admin`, `operator` or `customer`. Email is the login. |
| operators | `Operator`, `OperatorMembership` | Bus companies and who may act for them. |
| fleet | `SeatLayout`, `Seat`, `Bus` | Reusable seat maps and the buses that use them. |
| routes | `Stop`, `Route`, `RouteStop` | The network: stops, routes and their ordered timetable. |
| trips | `TripSchedule`, `Trip`, `TripStop` | Recurring timetables, the journeys generated from them, and per-trip stop times. |
| bookings | `Booking`, `Passenger`, `SeatLock` | A customer's reservation, who travels in each seat, and temporary seat holds. |
| payments | `Payment`, `PaymentEvent`, `Refund` | Every payment attempt, every gateway message, and money owed back. |
| tickets | `Ticket` | The e-ticket issued when a booking is confirmed. |
| audit | `ActivityLog` | What administrators changed. |

## The rules the database enforces itself

Application code can be wrong; these cannot be bypassed.

| Constraint | Table | Guarantees |
|------------|-------|-----------|
| `bookings_seatlock_seat_unique` | `bookings_seatlock` | One customer at a time can hold a given seat on a trip. |
| `bookings_passenger_seat_held_once` (partial, `holds_seat=true`) | `bookings_passenger` | A seat can be sold once per trip. |
| `bookings_booking_reference_unique` | `bookings_booking` | Booking references never repeat. |
| `trips_trip_no_bus_overlap` (exclusion, `tstzrange`) | `trips_trip` | One bus cannot be on two journeys at the same time. |
| `trips_trip_code_unique` | `trips_trip` | Trip codes never repeat. |
| `payments_event_unique` (`provider`, `event_id`) | `payments_paymentevent` | A gateway notification is applied exactly once, however many times it is delivered. |
| `payments_one_open_refund_per_payment` (partial) | `payments_refund` | A payment can only have one refund request in flight. |
| `tickets_ticket_number_unique` | `tickets_ticket` | Ticket numbers never repeat. |
| Check constraints | trips, bookings, payments | Arrival after departure, non-negative money, sane statuses. |

Seat selection and booking take a row lock on the trip (`SELECT … FOR UPDATE`) before they read
availability, so two customers racing for the last seat are serialised; the unique constraints
above are the backstop if that ever fails.

## Indexes

Foreign keys are indexed by Django. On top of those, each table carries indexes for the queries
the product actually runs:

| Table | Index | Serves |
|-------|-------|--------|
| `bookings_booking` | `(customer, -created_at)` | A customer's own booking history |
| | `(trip, status)` | Seat availability for a trip |
| | `(status, expires_at)` | The expiry sweep |
| | `(-created_at)` | The admin bookings list and the booking report |
| | `(status, cancelled_at)` | The cancellation report |
| `bookings_passenger` | `(trip, holds_seat)` | Who is travelling; the manifest |
| `bookings_seatlock` | `(trip, expires_at)`, `(customer, trip)`, `(expires_at)` | Holds and their expiry |
| `trips_trip` | `(route, departure_datetime)`, `(status, departure_datetime)`, `(bus, …)`, `(operator, …)` | Search, admin lists, occupancy |
| `trips_tripstop` | `(stop, departure_datetime)` | Search by boarding point |
| `payments_payment` | `(booking, status)`, `(status, created_at)`, `(status, expires_at)` | Checkout and reconciliation |
| | `(created_at)` where `requires_refund` | The refund queue |
| | `(status, paid_at)` | The revenue and payment reports |
| `payments_refund` | `(status, created_at)`, `(booking, -created_at)` | The refund queue |
| `accounts_user` | `(role, is_active)` | Admin user lists |

`apps/core/tests/test_query_counts.py` asserts that every list endpoint and every report costs
the same number of queries whether it returns one row or many — the N+1 regression net.

## Migrations

```bash
python manage.py makemigrations              # after any model change
python manage.py makemigrations --check --dry-run   # CI gate: fails if one is missing
python manage.py migrate                     # apply
python manage.py showmigrations              # what is applied
```

Migrations are additive and safe to run before the new code is live (that is the deployment
order: migrate, then swap the containers). Index creation on a large live table should use
`CREATE INDEX CONCURRENTLY` — Django can do this with `AddIndexConcurrently` from
`django.contrib.postgres.operations` in a non-atomic migration.

## Backups

```bash
# Snapshot
docker compose exec db pg_dump -U yathra -d yathra --format=custom --file=/tmp/yathra.dump
docker compose cp db:/tmp/yathra.dump ./yathra-$(date +%F).dump

# Restore into an empty database
docker compose cp ./yathra-2026-09-12.dump db:/tmp/restore.dump
docker compose exec db pg_restore -U yathra -d yathra --clean --if-exists /tmp/restore.dump
```

In production use the managed service's automated backups plus point-in-time recovery, and test
a restore before you need one. The database is the only stateful part of the system: Redis holds
nothing that cannot be rebuilt.
