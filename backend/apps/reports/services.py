"""
The seven admin reports.

Every number here is calculated by PostgreSQL: each report hands back the totals it aggregated
plus a *lazy* queryset of rows, so the API can page through them and an export can stream them
without either the server or the browser holding the whole result set.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import (
    Avg,
    Case,
    CharField,
    Count,
    DecimalField,
    F,
    FloatField,
    IntegerField,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Cast, Coalesce, Round, TruncDate

from apps.bookings.models import RELEASED_STATUSES, Booking, BookingStatus, Passenger
from apps.core.reporting import DateRange
from apps.payments.models import (
    CAPTURED_PAYMENT_STATUSES,
    OPEN_REFUND_STATUSES,
    Payment,
    PaymentStatus,
    Refund,
    RefundStatus,
)
from apps.trips.models import Trip

MONEY = DecimalField(max_digits=14, decimal_places=2)
ZERO = Value(Decimal("0"), output_field=MONEY)


@dataclass
class Report:
    """One report: what it is called, its columns, its totals and its (lazy) rows."""

    key: str
    title: str
    columns: list[tuple[str, str]]
    rows: QuerySet | list
    summary: dict[str, Any]
    summary_labels: list[tuple[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------
def _money(value) -> str:
    return f"{Decimal(value or 0):.2f}"


def _percent(part, whole) -> float:
    return round(float(part or 0) / float(whole) * 100, 1) if whole else 0.0


def booking_departure() -> Coalesce:
    """The passenger's own departure: their boarding point, else the trip's start."""
    return Coalesce("boarding_time", "trip__departure_datetime")


def seats_in_booking() -> Coalesce:
    counted = (
        Passenger.objects.filter(booking=OuterRef("pk"))
        .order_by()
        .values("booking")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return Coalesce(Subquery(counted, output_field=IntegerField()), Value(0))


def paid_for_booking() -> Coalesce:
    """Money captured for a booking, less anything refunded."""
    captured = (
        Payment.objects.filter(booking=OuterRef("pk"), status__in=CAPTURED_PAYMENT_STATUSES)
        .order_by()
        .values("booking")
        .annotate(total=Sum(F("amount") - F("refunded_amount"), output_field=MONEY))
        .values("total")
    )
    return Coalesce(Subquery(captured, output_field=MONEY), ZERO)


def latest_payment_status() -> Subquery:
    latest = Payment.objects.filter(booking=OuterRef("pk")).order_by("-created_at")
    return Subquery(latest.values("status")[:1])


def occupancy_percent() -> Case:
    """Seats sold / capacity × 100, worked out in SQL over the `seats_sold` annotation."""
    return Case(
        When(capacity=0, then=Value(0.0)),
        default=Round(
            Cast(F("seats_sold"), FloatField()) * Value(100.0) / Cast(F("capacity"), FloatField()),
            precision=1,
        ),
        output_field=FloatField(),
    )


def seats_sold_on_trip() -> Coalesce:
    """Seats a trip has actually sold: passengers still holding a seat."""
    sold = (
        Passenger.objects.filter(trip=OuterRef("pk"), holds_seat=True)
        .order_by()
        .values("trip")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return Coalesce(Subquery(sold, output_field=IntegerField()), Value(0))


def apply_filters(queryset: QuerySet, params, *, prefix: str = "") -> QuerySet:
    """The filters every report shares: route, operator, bus and trip."""
    # A prefix reaches the trip from somewhere else ("trip__", "booking__trip__"); without one
    # the queryset is already the trips themselves.
    trip_lookup = f"{prefix[:-2]}_id" if prefix else "id"
    lookups = {
        "route": f"{prefix}route_id",
        "operator": f"{prefix}operator_id",
        "bus": f"{prefix}bus_id",
        "trip": trip_lookup,
    }
    for param, lookup in lookups.items():
        value = params.get(param)
        if value:
            queryset = queryset.filter(**{lookup: value})
    return queryset


def trips_in_range(span: DateRange, params) -> QuerySet[Trip]:
    return apply_filters(span.filter(Trip.objects.all(), "departure_datetime"), params)


def bookings_in_range(span: DateRange, params, *, on: str = "created_at") -> QuerySet[Booking]:
    queryset = Booking.objects.annotate(departure=booking_departure())
    field_name = "departure" if on == "departure" else "created_at"
    return apply_filters(span.filter(queryset, field_name), params, prefix="trip__")


# ---------------------------------------------------------------------------
# 1. Bookings
# ---------------------------------------------------------------------------
def booking_report(span: DateRange, params) -> Report:
    on = "departure" if params.get("date_field") == "departure" else "created_at"
    bookings = bookings_in_range(span, params, on=on)

    totals = bookings.aggregate(
        bookings=Count("id"),
        value=Coalesce(Sum("total_amount"), ZERO),
        confirmed=Count("id", filter=Q(status=BookingStatus.CONFIRMED)),
        completed=Count("id", filter=Q(status=BookingStatus.COMPLETED)),
        cancelled=Count("id", filter=Q(status__in=RELEASED_STATUSES)),
        unpaid=Count(
            "id", filter=Q(status__in=(BookingStatus.PENDING, BookingStatus.PAYMENT_PENDING))
        ),
    )
    seats = Passenger.objects.filter(booking__in=bookings.values("pk")).count()

    rows = (
        bookings.annotate(
            seats=seats_in_booking(),
            paid_amount=paid_for_booking(),
            payment_status=latest_payment_status(),
        )
        .order_by("-created_at")
        .values(
            "id",
            "booking_reference",
            "created_at",
            "departure",
            "status",
            "seats",
            "total_amount",
            "paid_amount",
            "payment_status",
            customer_name=F("customer__name"),
            customer_email=F("customer__email"),
            route_name=F("trip__route__name"),
            trip_code=F("trip__code"),
        )
    )
    return Report(
        key="bookings",
        title="Booking report",
        columns=[
            ("booking_reference", "Reference"),
            ("created_at", "Booked on"),
            ("customer_name", "Customer"),
            ("customer_email", "Email"),
            ("route_name", "Route"),
            ("trip_code", "Trip"),
            ("departure", "Departure"),
            ("seats", "Seats"),
            ("total_amount", "Amount"),
            ("paid_amount", "Paid"),
            ("payment_status", "Payment"),
            ("status", "Booking status"),
        ],
        rows=rows,
        summary={
            "bookings": totals["bookings"],
            "seats": seats,
            "value": _money(totals["value"]),
            "confirmed": totals["confirmed"],
            "completed": totals["completed"],
            "cancelled": totals["cancelled"],
            "unpaid": totals["unpaid"],
            "average_value": _money(
                Decimal(totals["value"] or 0) / totals["bookings"] if totals["bookings"] else 0
            ),
        },
        summary_labels=[
            ("Bookings", str(totals["bookings"])),
            ("Seats", str(seats)),
            ("Value", _money(totals["value"])),
            ("Cancelled", str(totals["cancelled"])),
        ],
    )


# ---------------------------------------------------------------------------
# 2. Passengers
# ---------------------------------------------------------------------------
def passenger_queryset(span: DateRange, params) -> QuerySet[Passenger]:
    passengers = span.filter(Passenger.objects.all(), "trip__departure_datetime")
    passengers = apply_filters(passengers, params, prefix="trip__")
    if params.get("booking"):
        passengers = passengers.filter(booking_id=params["booking"])
    if params.get("holding") == "true":
        passengers = passengers.filter(holds_seat=True)
    search = (params.get("search") or "").strip()
    if search:
        passengers = passengers.filter(
            Q(name__icontains=search)
            | Q(phone__icontains=search)
            | Q(booking__booking_reference__icontains=search)
        )
    return passengers


def boarding_state() -> Case:
    """Boarded, still expected, or no longer travelling — decided in SQL, not in Python."""
    return Case(
        When(boarded_at__isnull=False, then=Value("boarded")),
        When(holds_seat=True, then=Value("expected")),
        default=Value("released"),
        output_field=CharField(),
    )


def passenger_rows(passengers: QuerySet[Passenger]) -> QuerySet:
    return (
        passengers.annotate(
            payment_status=latest_payment_status_for_passenger(),
            boarding_state=boarding_state(),
        )
        .order_by("trip__departure_datetime", "booking__booking_reference", "seat_number")
        .values(
            "id",
            "name",
            "phone",
            "seat_number",
            "holds_seat",
            "boarded_at",
            "payment_status",
            "boarding_state",
            "booking_id",
            "trip_id",
            booking_reference=F("booking__booking_reference"),
            booking_status=F("booking__status"),
            trip_code=F("trip__code"),
            route_name=F("trip__route__name"),
            bus_registration=F("trip__bus__registration_number"),
            departure=Coalesce("booking__boarding_time", "trip__departure_datetime"),
            boarding_point=F("booking__boarding_stop__name"),
            dropoff_point=F("booking__dropoff_stop__name"),
        )
    )


def latest_payment_status_for_passenger() -> Subquery:
    latest = Payment.objects.filter(booking=OuterRef("booking_id")).order_by("-created_at")
    return Subquery(latest.values("status")[:1])


def passenger_report(span: DateRange, params) -> Report:
    passengers = passenger_queryset(span, params)
    totals = passengers.aggregate(
        passengers=Count("id"),
        boarded=Count("id", filter=Q(boarded_at__isnull=False)),
        travelling=Count("id", filter=Q(holds_seat=True)),
    )
    return Report(
        key="passengers",
        title="Passenger report",
        columns=[
            ("name", "Passenger"),
            ("phone", "Phone"),
            ("booking_reference", "Booking"),
            ("route_name", "Route"),
            ("trip_code", "Trip"),
            ("departure", "Departure"),
            ("seat_number", "Seat"),
            ("boarding_point", "Boarding"),
            ("dropoff_point", "Drop-off"),
            ("payment_status", "Payment"),
            ("boarding_state", "Boarding"),
        ],
        rows=passenger_rows(passengers),
        summary={
            "passengers": totals["passengers"],
            "travelling": totals["travelling"],
            "boarded": totals["boarded"],
            "not_boarded": max(totals["travelling"] - totals["boarded"], 0),
        },
        summary_labels=[
            ("Passengers", str(totals["passengers"])),
            ("Travelling", str(totals["travelling"])),
            ("Boarded", str(totals["boarded"])),
        ],
    )


# ---------------------------------------------------------------------------
# 3. Revenue
# ---------------------------------------------------------------------------
def revenue_report(span: DateRange, params) -> Report:
    payments = span.filter(Payment.objects.filter(status__in=CAPTURED_PAYMENT_STATUSES), "paid_at")
    payments = apply_filters(payments, params, prefix="booking__trip__")

    totals = payments.aggregate(
        gross=Coalesce(Sum("amount"), ZERO),
        refunds=Coalesce(Sum("refunded_amount"), ZERO),
        payments=Count("id"),
        bookings=Count("booking_id", distinct=True),
    )
    gross, refunds = Decimal(totals["gross"] or 0), Decimal(totals["refunds"] or 0)
    net = gross - refunds
    bookings = totals["bookings"]

    rows = (
        payments.annotate(day=TruncDate("paid_at"))
        .order_by("-day")
        .values("day")
        .annotate(
            payments=Count("id"),
            bookings=Count("booking_id", distinct=True),
            gross=Coalesce(Sum("amount"), ZERO),
            refunds=Coalesce(Sum("refunded_amount"), ZERO),
            net=Coalesce(Sum(F("amount") - F("refunded_amount"), output_field=MONEY), ZERO),
        )
    )
    return Report(
        key="revenue",
        title="Revenue report",
        columns=[
            ("day", "Date"),
            ("bookings", "Bookings"),
            ("payments", "Payments"),
            ("gross", "Gross"),
            ("refunds", "Refunds"),
            ("net", "Net"),
        ],
        rows=rows,
        summary={
            "gross_revenue": _money(gross),
            "refunds": _money(refunds),
            "net_revenue": _money(net),
            "bookings": bookings,
            "payments": totals["payments"],
            "average_booking_value": _money(net / bookings if bookings else 0),
        },
        summary_labels=[
            ("Gross", _money(gross)),
            ("Refunds", _money(refunds)),
            ("Net", _money(net)),
            ("Bookings", str(bookings)),
            ("Average", _money(net / bookings if bookings else 0)),
        ],
    )


# ---------------------------------------------------------------------------
# 4. Route performance
# ---------------------------------------------------------------------------
def route_report(span: DateRange, params) -> Report:
    trips = trips_in_range(span, params)
    capacity = (
        trips.order_by()
        .values("route_id")
        .annotate(
            route_name=F("route__name"),
            trips=Count("id"),
            capacity=Coalesce(Sum("bus__seat_capacity"), Value(0)),
        )
    )
    sold = (
        Passenger.objects.filter(trip__in=trips.values("pk"), holds_seat=True)
        .order_by()
        .values("trip__route_id")
        .annotate(seats=Count("id"), bookings=Count("booking_id", distinct=True))
    )
    revenue = (
        Payment.objects.filter(
            booking__trip__in=trips.values("pk"), status__in=CAPTURED_PAYMENT_STATUSES
        )
        .order_by()
        .values("booking__trip__route_id")
        .annotate(
            gross=Coalesce(Sum("amount"), ZERO),
            refunds=Coalesce(Sum("refunded_amount"), ZERO),
        )
    )
    cancelled = (
        Booking.objects.filter(trip__in=trips.values("pk"), status__in=RELEASED_STATUSES)
        .order_by()
        .values("trip__route_id")
        .annotate(cancelled=Count("id"))
    )

    by_sold = {row["trip__route_id"]: row for row in sold}
    by_revenue = {row["booking__trip__route_id"]: row for row in revenue}
    by_cancelled = {row["trip__route_id"]: row["cancelled"] for row in cancelled}

    rows = []
    for row in capacity:
        route_id = row["route_id"]
        seats = by_sold.get(route_id, {}).get("seats", 0)
        money = by_revenue.get(route_id, {})
        gross = Decimal(money.get("gross") or 0)
        refunds = Decimal(money.get("refunds") or 0)
        rows.append(
            {
                "route_id": str(route_id),
                "route_name": row["route_name"],
                "trips": row["trips"],
                "capacity": row["capacity"],
                "seats_sold": seats,
                "occupancy": _percent(seats, row["capacity"]),
                "bookings": by_sold.get(route_id, {}).get("bookings", 0),
                "cancellations": by_cancelled.get(route_id, 0),
                "gross": gross,
                "net": gross - refunds,
                "average_fare": (gross / seats) if seats else Decimal("0"),
            }
        )
    rows.sort(key=lambda row: row["net"], reverse=True)

    total_capacity = sum(row["capacity"] for row in rows)
    total_sold = sum(row["seats_sold"] for row in rows)
    total_net = sum((row["net"] for row in rows), Decimal("0"))
    return Report(
        key="routes",
        title="Route performance report",
        columns=[
            ("route_name", "Route"),
            ("trips", "Trips"),
            ("bookings", "Bookings"),
            ("seats_sold", "Seats sold"),
            ("capacity", "Capacity"),
            ("occupancy", "Occupancy %"),
            ("cancellations", "Cancellations"),
            ("gross", "Gross"),
            ("net", "Net"),
            ("average_fare", "Average fare"),
        ],
        rows=rows,
        summary={
            "routes": len(rows),
            "trips": sum(row["trips"] for row in rows),
            "seats_sold": total_sold,
            "capacity": total_capacity,
            "occupancy": _percent(total_sold, total_capacity),
            "net_revenue": _money(total_net),
            "best_route": rows[0]["route_name"] if rows else None,
        },
        summary_labels=[
            ("Routes", str(len(rows))),
            ("Seats sold", f"{total_sold} / {total_capacity}"),
            ("Occupancy", f"{_percent(total_sold, total_capacity)}%"),
            ("Net", _money(total_net)),
        ],
    )


# ---------------------------------------------------------------------------
# 5. Bus occupancy
# ---------------------------------------------------------------------------
OCCUPANCY_GROUPS = ("trip", "route", "bus", "date")


def occupancy_report(span: DateRange, params) -> Report:
    group_by = params.get("group_by") or "trip"
    if group_by not in OCCUPANCY_GROUPS:
        group_by = "trip"
    trips = trips_in_range(span, params)

    totals = trips.aggregate(
        trips=Count("id"), capacity=Coalesce(Sum("bus__seat_capacity"), Value(0))
    )
    sold_total = Passenger.objects.filter(trip__in=trips.values("pk"), holds_seat=True).count()

    if group_by == "trip":
        rows = (
            trips.annotate(seats_sold=seats_sold_on_trip(), capacity=F("bus__seat_capacity"))
            .annotate(occupancy=occupancy_percent())
            .order_by("departure_datetime")
            .values(
                "id",
                "departure_datetime",
                "seats_sold",
                "capacity",
                "occupancy",
                trip_code=F("code"),
                route_name=F("route__name"),
                bus_registration=F("bus__registration_number"),
            )
        )
        columns = [
            ("trip_code", "Trip"),
            ("route_name", "Route"),
            ("bus_registration", "Bus"),
            ("departure_datetime", "Departure"),
            ("seats_sold", "Seats sold"),
            ("capacity", "Capacity"),
            ("occupancy", "Occupancy %"),
        ]
    else:
        keys = {
            "route": ("route_id", F("route__name"), "trip__route_id"),
            "bus": ("bus_id", F("bus__registration_number"), "trip__bus_id"),
            "date": (None, None, None),
        }
        if group_by == "date":
            capacity_rows = (
                trips.annotate(day=TruncDate("departure_datetime"))
                .order_by()
                .values("day")
                .annotate(trips=Count("id"), capacity=Coalesce(Sum("bus__seat_capacity"), Value(0)))
            )
            sold_rows = (
                Passenger.objects.filter(trip__in=trips.values("pk"), holds_seat=True)
                .annotate(day=TruncDate("trip__departure_datetime"))
                .order_by()
                .values("day")
                .annotate(seats=Count("id"))
            )
            by_sold = {row["day"]: row["seats"] for row in sold_rows}
            rows = [
                {
                    "group": row["day"],
                    "label": row["day"].isoformat()
                    if isinstance(row["day"], date)
                    else str(row["day"]),
                    "trips": row["trips"],
                    "capacity": row["capacity"],
                    "seats_sold": by_sold.get(row["day"], 0),
                    "occupancy": _percent(by_sold.get(row["day"], 0), row["capacity"]),
                }
                for row in capacity_rows
            ]
            rows.sort(key=lambda row: str(row["group"]))
        else:
            id_field, label_field, passenger_field = keys[group_by]
            capacity_rows = (
                trips.order_by()
                .values(id_field)
                .annotate(
                    label=label_field,
                    trips=Count("id"),
                    capacity=Coalesce(Sum("bus__seat_capacity"), Value(0)),
                )
            )
            sold_rows = (
                Passenger.objects.filter(trip__in=trips.values("pk"), holds_seat=True)
                .order_by()
                .values(passenger_field)
                .annotate(seats=Count("id"))
            )
            by_sold = {row[passenger_field]: row["seats"] for row in sold_rows}
            rows = [
                {
                    "group": str(row[id_field]),
                    "label": row["label"],
                    "trips": row["trips"],
                    "capacity": row["capacity"],
                    "seats_sold": by_sold.get(row[id_field], 0),
                    "occupancy": _percent(by_sold.get(row[id_field], 0), row["capacity"]),
                }
                for row in capacity_rows
            ]
            rows.sort(key=lambda row: row["occupancy"], reverse=True)
        columns = [
            ("label", {"route": "Route", "bus": "Bus", "date": "Date"}[group_by]),
            ("trips", "Trips"),
            ("seats_sold", "Seats sold"),
            ("capacity", "Capacity"),
            ("occupancy", "Occupancy %"),
        ]

    return Report(
        key="occupancy",
        title="Bus occupancy report",
        columns=columns,
        rows=rows,
        summary={
            "group_by": group_by,
            "trips": totals["trips"],
            "capacity": totals["capacity"],
            "seats_sold": sold_total,
            "occupancy": _percent(sold_total, totals["capacity"]),
            "empty_seats": max((totals["capacity"] or 0) - sold_total, 0),
        },
        summary_labels=[
            ("Trips", str(totals["trips"])),
            ("Seats sold", f"{sold_total} / {totals['capacity']}"),
            ("Occupancy", f"{_percent(sold_total, totals['capacity'])}%"),
        ],
    )


# ---------------------------------------------------------------------------
# 6. Cancellations
# ---------------------------------------------------------------------------
def cancellation_report(span: DateRange, params) -> Report:
    cancelled = apply_filters(
        span.filter(Booking.objects.filter(status=BookingStatus.CANCELLED), "cancelled_at"),
        params,
        prefix="trip__",
    )
    made = apply_filters(span.filter(Booking.objects.all(), "created_at"), params, prefix="trip__")

    refund_total = (
        Refund.objects.filter(booking=OuterRef("pk"))
        .order_by()
        .values("booking")
        .annotate(total=Sum("amount"))
        .values("total")
    )
    refund_status = (
        Refund.objects.filter(booking=OuterRef("pk")).order_by("-created_at").values("status")[:1]
    )

    totals = cancelled.aggregate(
        cancellations=Count("id"),
        value=Coalesce(Sum("total_amount"), ZERO),
        seats=Coalesce(Sum(seats_in_booking()), Value(0)),
    )
    refunds = Refund.objects.filter(booking__in=cancelled.values("pk")).aggregate(
        requested=Coalesce(Sum("amount"), ZERO),
        completed=Coalesce(Sum("amount", filter=Q(status=RefundStatus.COMPLETED)), ZERO),
        open=Count("id", filter=Q(status__in=OPEN_REFUND_STATUSES)),
    )
    booked = made.count()

    rows = (
        cancelled.annotate(
            seats=seats_in_booking(),
            refund_amount=Coalesce(Subquery(refund_total, output_field=MONEY), ZERO),
            refund_status=Subquery(refund_status),
            departure=booking_departure(),
        )
        .order_by("-cancelled_at")
        .values(
            "id",
            "booking_reference",
            "cancelled_at",
            "cancellation_reason",
            "seats",
            "total_amount",
            "refund_amount",
            "refund_status",
            "departure",
            customer_name=F("customer__name"),
            route_name=F("trip__route__name"),
        )
    )
    return Report(
        key="cancellations",
        title="Cancellation report",
        columns=[
            ("booking_reference", "Reference"),
            ("cancelled_at", "Cancelled on"),
            ("customer_name", "Customer"),
            ("route_name", "Route"),
            ("departure", "Departure"),
            ("seats", "Seats"),
            ("total_amount", "Booking value"),
            ("refund_amount", "Refund"),
            ("refund_status", "Refund status"),
            ("cancellation_reason", "Reason"),
        ],
        rows=rows,
        summary={
            "cancellations": totals["cancellations"],
            "seats_released": totals["seats"],
            "value": _money(totals["value"]),
            "bookings_made": booked,
            "cancellation_rate": _percent(totals["cancellations"], booked),
            "refunds_requested": _money(refunds["requested"]),
            "refunds_completed": _money(refunds["completed"]),
            "refunds_open": refunds["open"],
        },
        summary_labels=[
            ("Cancellations", str(totals["cancellations"])),
            ("Rate", f"{_percent(totals['cancellations'], booked)}%"),
            ("Refunds requested", _money(refunds["requested"])),
            ("Still open", str(refunds["open"])),
        ],
    )


# ---------------------------------------------------------------------------
# 7. Payments
# ---------------------------------------------------------------------------
def payment_report(span: DateRange, params) -> Report:
    payments = apply_filters(
        span.filter(Payment.objects.all(), "created_at"), params, prefix="booking__trip__"
    )
    if params.get("status"):
        payments = payments.filter(status=params["status"])
    if params.get("provider"):
        payments = payments.filter(provider=params["provider"])

    totals = payments.aggregate(
        payments=Count("id"),
        captured=Coalesce(Sum("amount", filter=Q(status__in=CAPTURED_PAYMENT_STATUSES)), ZERO),
        refunded=Coalesce(Sum("refunded_amount"), ZERO),
        failed=Count("id", filter=Q(status=PaymentStatus.FAILED)),
        cancelled=Count("id", filter=Q(status=PaymentStatus.CANCELLED)),
        successful=Count("id", filter=Q(status__in=CAPTURED_PAYMENT_STATUSES)),
        average=Avg("amount", filter=Q(status__in=CAPTURED_PAYMENT_STATUSES)),
    )
    by_provider = list(
        payments.filter(status__in=CAPTURED_PAYMENT_STATUSES)
        .order_by()
        .values("provider")
        .annotate(payments=Count("id"), amount=Coalesce(Sum("amount"), ZERO))
        .order_by("-amount")
    )

    rows = payments.order_by("-created_at").values(
        "id",
        "transaction_reference",
        "created_at",
        "paid_at",
        "provider",
        "payment_method",
        "amount",
        "refunded_amount",
        "status",
        booking_reference=F("booking__booking_reference"),
        customer_name=F("booking__customer__name"),
    )
    captured = Decimal(totals["captured"] or 0)
    refunded = Decimal(totals["refunded"] or 0)
    return Report(
        key="payments",
        title="Payment report",
        columns=[
            ("transaction_reference", "Transaction"),
            ("created_at", "Started"),
            ("paid_at", "Paid"),
            ("booking_reference", "Booking"),
            ("customer_name", "Customer"),
            ("provider", "Gateway"),
            ("payment_method", "Method"),
            ("amount", "Amount"),
            ("refunded_amount", "Refunded"),
            ("status", "Status"),
        ],
        rows=rows,
        summary={
            "payments": totals["payments"],
            "successful": totals["successful"],
            "failed": totals["failed"],
            "cancelled": totals["cancelled"],
            "captured": _money(captured),
            "refunded": _money(refunded),
            "net": _money(captured - refunded),
            "average_payment": _money(totals["average"] or 0),
            "by_provider": [
                {
                    "provider": row["provider"],
                    "payments": row["payments"],
                    "amount": _money(row["amount"]),
                }
                for row in by_provider
            ],
        },
        summary_labels=[
            ("Payments", str(totals["payments"])),
            ("Successful", str(totals["successful"])),
            ("Captured", _money(captured)),
            ("Net", _money(captured - refunded)),
        ],
    )


REPORTS = {
    "bookings": (booking_report, "Every booking made or travelling in the period."),
    "passengers": (passenger_report, "Who is travelling, on which seat, and whether they boarded."),
    "revenue": (revenue_report, "Gross, refunds and net takings, day by day."),
    "routes": (route_report, "How each route performed: seats, occupancy and takings."),
    "occupancy": (occupancy_report, "Seats sold against capacity, by trip, route, bus or date."),
    "cancellations": (cancellation_report, "What was cancelled, why, and what it cost."),
    "payments": (payment_report, "Every payment attempt and what became of it."),
}


def build(key: str, span: DateRange, params) -> Report:
    builder, _ = REPORTS[key]
    return builder(span, params)
