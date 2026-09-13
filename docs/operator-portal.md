# The operator portal

A bus company signs in at `/login` (with email) and lands on `/operator`: its own trips, the people
booked on them, the printable manifest, and — for owners and managers — the takings. Everything is
limited to that company on the server; another company's trip or booking is simply *not found*.

## Who sees what

A user becomes an operator when an admin links them to a company (Django admin → *Operator
memberships*) with a role:

| | Owner | Manager | Staff |
|---|:---:|:---:|:---:|
| Overview: today's trips, passengers, next departures | ✓ | ✓ | ✓ |
| Trips, trip details, stops | ✓ | ✓ | ✓ |
| Manifest (screen, print, PDF) | ✓ | ✓ | ✓ |
| Bookings, with passengers' phone numbers | ✓ | ✓ | ✓ |
| Takings on the overview and on each trip | ✓ | ✓ | |
| Revenue report (by day, by route) and its CSV / Excel / PDF | ✓ | ✓ | |

Staff are conductors and counter clerks: they need to know who is on the bus and how to call a
passenger who hasn't turned up, not what the company earned.

A company that is **pending approval** or **suspended** sees its company details and an
explanation, and nothing else. A membership that has been switched off sees nothing.

## Screens

| Page | What it's for |
|------|---------------|
| **Overview** `/operator` | Today: trips (and how many were cancelled), passengers and how many have boarded, bookings paid today, takings today and this month. The next six departures with seats sold and a one-tap manifest. Refreshes every minute. |
| **Trips** `/operator/trips` | *Today & upcoming* or *Past*; search by trip code, route or bus; filter by status and dates. Each row shows seats sold as a bar, and who has boarded. |
| **Trip** `/operator/trips/{id}` | Status, bus, fare, seats, bookings (paid / awaiting payment / cancelled), the stops with times, and — for managers — the trip's takings. |
| **Manifest** `/operator/trips/{id}/manifest` | The same printable sheet the admin console prints: seat, passenger, phone, boarding and drop-off point, booking, status. Print it or download the PDF. |
| **Bookings** `/operator/bookings` | Every booking on the company's trips. Search by reference, name or phone number — typed any way (`077 123 4567` finds `+94771234567`). |
| **Booking** `/operator/bookings/{id}` | The journey, the customer's name and phone, what was paid, refunds, and each passenger with a tap-to-call number. Read-only: cancelling a booking stays with support. |
| **Revenue** `/operator/revenue` | Gross, refunds and net for any period (today, yesterday, this week, this month, custom, all time), day by day or route by route, with downloads. |

What an operator never sees: customers' e-mail addresses, payment gateway references, ticket links
or QR codes, other companies' data, and the other admin reports.

## API

All under `/api/v1/operator/`, all requiring an operator account in an approved company:

| Method | Path | |
|--------|------|-|
| GET | `profile/` | The company and your role (works while pending) |
| GET | `dashboard/` | Today, next departures, and `revenue` (null for staff) |
| GET | `trips/` | `?when=upcoming\|past`, `status`, `route`, `bus`, `date_from`, `date_to`, `search`, `ordering` |
| GET | `trips/{id}/` | Stops, booking counts, `revenue` (null for staff) |
| GET | `trips/{id}/manifest/`, `trips/{id}/manifest/pdf/` | The manifest |
| GET | `bookings/` | `status`, `trip`, `route`, `date_from`/`date_to` (booked), `departure_from`/`departure_to`, `search` |
| GET | `bookings/{id}/` | One booking |
| GET | `reports/revenue/`, `reports/routes/` | Owners and managers. The shared date filter; `operator` is always your own, whatever is asked |
| GET | `reports/{key}/export/?format=csv\|xlsx\|pdf` | The same, as a file |

The reports are the admin reports (`apps/reports/services.py`) with the company filter forced on,
so the numbers an operator sees are exactly the numbers the platform sees for that company.
