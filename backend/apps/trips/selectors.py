"""Read-side queries for trips: what's on sale, seat availability and the seat map."""

from django.db.models import (
    Count,
    Exists,
    F,
    IntegerField,
    OuterRef,
    Prefetch,
    QuerySet,
    Subquery,
    Value,
)
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

from apps.bookings.models import (
    Booking,
    Passenger,
    SeatLock,
    booking_holds_seats,
    passenger_holds_seat,
)
from apps.fleet.models import BOOKABLE_SEAT_TYPES, CREW_SEAT_TYPES
from apps.operators.models import OperatorStatus

from .models import Trip, TripStatus, TripStop

SEAT_AVAILABLE = "available"
SEAT_LOCKED = "locked"  # temporarily held by a customer who is booking it
SEAT_BOOKED = "booked"
SEAT_BLOCKED = "blocked"  # crew, reserved, blocked off, or beyond the seats for sale


def on_sale_trips() -> QuerySet[Trip]:
    """Trips customers can see: scheduled and on sale, on an active bus, route and operator."""
    return Trip.objects.filter(
        status=TripStatus.SCHEDULED,
        active=True,
        operator__status=OperatorStatus.ACTIVE,
        bus__active=True,
        bus__seat_layout__isnull=False,
        route__active=True,
    )


def bookable_trips() -> QuerySet[Trip]:
    """On-sale trips that still have a boarding point ahead of them."""
    upcoming_boarding = TripStop.objects.filter(
        trip=OuterRef("pk"),
        is_boarding_point=True,
        stop__active=True,
        departure_datetime__gt=timezone.now(),
    )
    return on_sale_trips().filter(Exists(upcoming_boarding))


def _count(queryset: QuerySet) -> Coalesce:
    per_trip = queryset.order_by().values("trip").annotate(total=Count("pk")).values("total")
    return Coalesce(Subquery(per_trip, output_field=IntegerField()), Value(0))


def with_availability(queryset: QuerySet[Trip]) -> QuerySet[Trip]:
    """
    Annotate live seat counts per trip: `booked_seats` (held by bookings), `locked_seats`
    (temporary locks), `booking_count` and `available_seats`. Calculated per trip, so the same
    bus on another trip is unaffected.
    """
    now = timezone.now()
    return queryset.annotate(
        booked_seats=_count(
            Passenger.objects.filter(trip=OuterRef("pk")).filter(passenger_holds_seat(now))
        ),
        locked_seats=_count(SeatLock.objects.filter(trip=OuterRef("pk"), expires_at__gt=now)),
        booking_count=_count(
            Booking.objects.filter(trip=OuterRef("pk")).filter(booking_holds_seats(now))
        ),
    ).annotate(
        available_seats=Greatest(
            F("bus__seat_capacity") - F("booked_seats") - F("locked_seats"), Value(0)
        )
    )


def ordered_stops() -> Prefetch:
    return Prefetch(
        "trip_stops", queryset=TripStop.objects.select_related("stop").order_by("sequence")
    )


def public_trips() -> QuerySet[Trip]:
    """Bookable trips with availability, ready for display."""
    return (
        with_availability(bookable_trips())
        .select_related("route__origin", "route__destination", "operator", "bus__seat_layout")
        .prefetch_related(ordered_stops())
    )


def sellable_seats(trip: Trip) -> list:
    """
    Seats sold for this trip. A bus may sell fewer seats than its layout offers
    (`seat_capacity`); then the first bookable seats front-to-back are the ones for sale.
    """
    seats = trip.bus.seat_layout.seats.filter(
        seat_type__in=BOOKABLE_SEAT_TYPES, is_available=True
    ).order_by("row", "column")
    return list(seats[: trip.bus.seat_capacity])


def seat_map(trip: Trip, viewer=None) -> dict:
    """
    The admin-configured seat layout with each seat's status for this trip. Locks held by
    `viewer` are flagged `locked_by_me` so their own selection can be shown.
    """
    now = timezone.now()
    held = {
        number.strip().upper()
        for number in Passenger.objects.filter(trip=trip)
        .filter(passenger_holds_seat(now))
        .values_list("seat_number", flat=True)
    }
    locks = {
        lock.seat_number.strip().upper(): lock.customer_id
        for lock in SeatLock.objects.filter(trip=trip, expires_at__gt=now)
    }
    for_sale = {seat.seat_number.strip().upper() for seat in sellable_seats(trip)}
    viewer_id = getattr(viewer, "pk", None)

    seats = []
    for seat in trip.bus.seat_layout.seats.order_by("row", "column"):
        number = seat.seat_number.strip().upper()
        locked_by_me = False
        if seat.seat_type in CREW_SEAT_TYPES:
            status = SEAT_BLOCKED
        elif number in held:
            status = SEAT_BOOKED
        elif number in locks:
            status = SEAT_LOCKED
            locked_by_me = viewer_id is not None and locks[number] == viewer_id
        elif number in for_sale:
            status = SEAT_AVAILABLE
        else:
            status = SEAT_BLOCKED
        seats.append(
            {
                "seat_number": seat.seat_number,
                "row": seat.row,
                "column": seat.column,
                "seat_type": seat.seat_type,
                "status": status,
                "locked_by_me": locked_by_me,
            }
        )

    def count(status: str) -> int:
        return sum(1 for seat in seats if seat["status"] == status)

    layout = trip.bus.seat_layout
    return {
        "layout": {
            "name": layout.name,
            "layout_type": layout.layout_type,
            "rows": layout.rows,
            "columns": layout.columns,
        },
        "seat_capacity": trip.bus.seat_capacity,
        "available_seats": count(SEAT_AVAILABLE),
        "booked_seats": count(SEAT_BOOKED),
        "locked_seats": count(SEAT_LOCKED),
        "seats": seats,
    }
