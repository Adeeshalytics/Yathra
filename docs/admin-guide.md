# Administrator's guide

How the office runs the platform, screen by screen. Sign in at `/login` with an administrator
account; you land on the dashboard at `/admin`.

The Django admin at `/django-admin/` exists for emergencies only. Use the screens below for
day-to-day work — they enforce the business rules and write to the activity log.

---

## Before you can sell a ticket

Set these up in order; each one depends on the one above it.

1. **Operators** (`/admin/operators`) — the bus companies. A company must be **active** before
   its buses can carry passengers. Pending companies can be prepared but not sold.
2. **Seat layouts** (`/admin/seat-layouts`) — reusable seat maps. Use **Generate** for a standard
   grid (rows × columns, aisle position), then adjust individual seats: crew, reserved, blocked.
   One layout usually serves a whole class of bus.
3. **Buses** (`/admin/buses`) — registration, name, type and facilities, pointing at an operator
   and a seat layout. A bus without a layout cannot be scheduled.
4. **Stops** (`/admin/stops`) — every place a bus can pick up or drop off, with its city.
5. **Routes** (`/admin/routes`) — origin, destination and the ordered stops between them, each
   with its minutes from departure. A route needs at least two stops before trips can run on it.

## Selling seats

6. **Trips** (`/admin/trips`) — one journey: a route, a bus, a departure time and a price. Stop
   times are filled in from the route's timetable; **Reset timings** re-reads them if the route
   changed. A bus cannot be on two journeys at once — the system refuses the overlap.
7. **Schedules** (`/admin/schedules`) — a recurring timetable (daily, or chosen weekdays).
   **Generate** creates the trips for a date range; preview first with the dry run.

Useful trip actions:

- **Deactivate** takes a trip off sale without cancelling it — existing bookings stand.
- **Cancel** ends the trip, releases every seat and raises refunds for anyone who paid. It cannot
  be undone, and you must give a reason.
- **Status** moves a trip along: scheduled → boarding → departed → completed.

## Day of travel

**Passengers** (`/admin/passengers`) answers "who is on this bus?". Filter by trip, route, bus,
travel date or booking, or search a name, phone number or booking reference. Tick people off as
they board; a seat that went back on sale shows as *Not travelling* and cannot be boarded.

**Manifest** (from a trip → **Manifest**) is the printed list, in seat order, with boarding and
drop-off points and a space for the driver's signature. **Print** uses the browser; **Download
PDF** asks the server for the same page, which is what to do from a phone at a depot.

## Bookings and money

**Bookings** (`/admin/bookings`) is every booking on the platform. Search by reference, customer
or passenger; filter by status, payment status, trip, route, or the dates people booked or
travel. Open one for the full picture: passengers and seats, boarding and drop-off points, the
payment, the e-ticket and any refunds.

**Cancelling for a customer** — from a booking, **Cancel booking**. You see the same policy the
customer sees, taken with staff powers: support can cancel inside the cut-off when the customer
cannot, and the customer then gets everything back. The reason you type is kept on the booking
and in the activity log. A booking that has already been cancelled or travelled cannot be
cancelled again, by anyone.

**Payments** (`/admin/payments`) lists every attempt with its gateway, amount and status.

- **Check with gateway** re-asks the gateway about an attempt whose notification never arrived.
- **Refund** returns money through the gateway, or records a refund you made in the gateway's own
  portal when it has no refund API. Partial refunds are allowed.
- *Needs refund* marks money taken for a booking that could not be honoured.

**Refunds** (`/admin/refunds`) is the queue of money owed: **Requested → Processing → Completed**
or **Rejected**. Completing one actually moves the money. The amounts are frozen when the request
is raised, so changing the cancellation policy later never rewrites what someone was promised.

## Reports

**Reports** (`/admin/reports`) runs seven reports over a period you choose — today, yesterday,
this week, this month, a custom range, or all time — with optional route, operator, bus and trip
filters.

| Report | Use it for |
|--------|-----------|
| Booking | What was sold, to whom, and for how much |
| Passenger | Who travelled, on which seat, and whether they boarded |
| Revenue | Gross, refunds and net takings, day by day |
| Route performance | Which routes earn, and how full they run |
| Bus occupancy | Seats sold ÷ capacity, by trip, route, bus or date |
| Cancellation | What was cancelled, why, and what it cost |
| Payment | Every attempt, by gateway, and what became of it |

**CSV** and **Excel** carry every row; **PDF** is capped at 1,000 rows because it is meant to be
read. Totals come from the database, so a report over a year costs the same as one over a day.

The dashboard's **Trading** section charts the same numbers: daily bookings, daily revenue,
occupancy, cancellations and the best-earning routes.

## Keeping an eye on things

**Activity** (`/admin/activity`) records who changed what, and when: every create, update,
delete, activation, cancellation and refund decision, with the fields that changed.

The server also writes a structured event log for sign-ins, seat locks, bookings, payments,
cancellations, refunds and administrator actions. In production those lines are JSON, each
stamped with a request id, so an incident can be reconstructed end to end.

## Things the system will not let you do

These refusals are deliberate — if you hit one, the answer is not to force it.

- Deleting a record that is in use (a route with trips, a bus with bookings). Deactivate it.
- Putting a cancelled or completed trip back on sale.
- Scheduling a bus onto two overlapping journeys.
- Cancelling a booking that is already cancelled, expired or travelled.
- Selling a seat that another customer is holding, until their hold runs out.
