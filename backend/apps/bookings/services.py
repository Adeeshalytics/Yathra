"""
The booking engine: temporary seat locks, bookings and their life cycle.

Double booking is prevented in three layers:

1. Every change to a trip's seats (lock, release, book, pay, cancel) runs in a transaction that
   first takes a row lock on the trip (SELECT … FOR UPDATE). Changes to one trip's seats
   therefore happen strictly one at a time; different trips don't wait for each other.
2. The database allows one SeatLock per (trip, seat).
3. The database allows one seat-holding Passenger per (trip, seat).

Holds expire by themselves: an expired lock or unpaid booking stops counting the moment it
expires, is cleared the next time that trip's seats change, and is swept by the
`expire_seat_holds` management command.

Payments (apps.payments) confirm bookings only through the "payment hooks" below, so the
seat rules live in one place. Lock order is always trip → booking → payment, so these
transactions cannot deadlock each other.
"""

import functools
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.db import violated_constraint
from apps.core.exceptions import Conflict
from apps.core.logging import log_event
from apps.notifications.services import notify_booking_confirmed
from apps.payments import refunds as refund_requests
from apps.payments.models import (
    OPEN_PAYMENT_STATUSES,
    REFUNDABLE_PAYMENT_STATUSES,
    Payment,
    PaymentMethod,
    PaymentStatus,
)
from apps.payments.providers import MANUAL_PROVIDER
from apps.tickets.services import issue_ticket
from apps.trips.models import Trip, TripStop
from apps.trips.selectors import bookable_trips, sellable_seats

from . import cancellation, pricing
from .models import (
    HELD_SEAT_CONSTRAINT,
    PAID_STATUSES,
    RELEASED_STATUSES,
    SEAT_LOCK_CONSTRAINT,
    UNPAID_STATUSES,
    Booking,
    BookingStatus,
    Passenger,
    SeatLock,
    passenger_holds_seat,
)

MAX_SEATS_PER_TRIP = 10


def lock_duration() -> timedelta:
    return timedelta(minutes=getattr(settings, "SEAT_LOCK_MINUTES", 5))


def normalize_seat(value) -> str:
    return str(value).strip().upper()


def seat_sort_key(number: str) -> tuple:
    """Seat numbers in natural order: 2 before 10, numbers before letters."""
    return (0, int(number), "") if number.isdigit() else (1, 0, number)


def _seat_list(numbers) -> str:
    return ", ".join(sorted(numbers, key=seat_sort_key))


class SeatsUnavailable(Conflict):
    default_code = "seats_unavailable"

    def __init__(self, seats: dict[str, str]):
        noun = "Seat" if len(seats) == 1 else "Seats"
        verb = "isn’t" if len(seats) == 1 else "aren’t"
        super().__init__(
            f"{noun} {_seat_list(seats)} {verb} available any more.",
            details={"seats": dict(sorted(seats.items(), key=lambda item: seat_sort_key(item[0])))},
        )


class HoldExpired(Conflict):
    default_code = "hold_expired"


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------
def _lock_trip(trip_id, *, bookable: bool) -> Trip:
    """
    The trip, row-locked until the transaction ends. `bookable` also requires the trip to be
    on sale with a boarding point still ahead (404 otherwise).
    """
    queryset = bookable_trips() if bookable else Trip.objects.all()
    trip = (
        queryset.select_for_update(of=("self",))
        .select_related("bus__seat_layout")
        .filter(pk=trip_id)
        .first()
    )
    if trip is None:
        raise Http404("This trip isn’t available for booking.")
    return trip


def _lock_booking(booking: Booking) -> Booking:
    """Lock the booking's trip, then the booking itself, and return a fresh copy."""
    _lock_trip(booking.trip_id, bookable=False)
    return Booking.objects.select_for_update().select_related("trip").get(pk=booking.pk)


def sweep_trip(trip_id) -> None:
    """Expire a trip's stale holds in a transaction of their own, so it sticks even when the
    operation that follows is refused (e.g. paying after the hold ran out)."""
    with transaction.atomic():
        trip = Trip.objects.select_for_update().filter(pk=trip_id).first()
        if trip is not None:
            _release_stale(trip, timezone.now())


def _swept(func):
    """Sweep the booking's trip first, then run `func(booking, …)` atomically."""

    @functools.wraps(func)
    def wrapper(booking, *args, **kwargs):
        sweep_trip(booking.trip_id)
        with transaction.atomic():
            return func(booking, *args, **kwargs)

    return wrapper


def _expire_unpaid(bookings, now) -> int:
    """Mark unpaid bookings whose hold has run out as expired and free their seats."""
    stale = list(
        bookings.filter(status__in=UNPAID_STATUSES, expires_at__lte=now)
        .select_for_update(skip_locked=True)
        .values_list("pk", flat=True)
    )
    if stale:
        Booking.objects.filter(pk__in=stale).update(status=BookingStatus.EXPIRED, updated_at=now)
        Passenger.objects.filter(booking_id__in=stale).update(holds_seat=False, updated_at=now)
    return len(stale)


def _release_stale(trip: Trip, now) -> None:
    """Clear this trip's expired locks and holds (the caller holds the trip lock)."""
    SeatLock.objects.filter(trip=trip, expires_at__lte=now).delete()
    _expire_unpaid(Booking.objects.filter(trip=trip), now)


def release_expired_holds(*, customer=None, now=None) -> tuple[int, int]:
    """
    Sweep expired locks and unpaid bookings everywhere (or for one customer). Safe to run at
    any time: it only ever releases seats. Returns (locks removed, bookings expired).
    """
    now = now or timezone.now()
    locks = SeatLock.objects.filter(expires_at__lte=now)
    bookings = Booking.objects.all()
    if customer is not None:
        locks = locks.filter(customer=customer)
        bookings = bookings.filter(customer=customer)
    removed, _ = locks.delete()
    with transaction.atomic():
        expired = _expire_unpaid(bookings, now)
    return removed, expired


def _held_seats(trip: Trip, now) -> set[str]:
    return {
        normalize_seat(number)
        for number in Passenger.objects.filter(trip=trip)
        .filter(passenger_holds_seat(now))
        .values_list("seat_number", flat=True)
    }


def _close_open_payments(booking_ids, reason: str, now) -> None:
    """Stop waiting on payment attempts for these bookings. If the gateway reports one as paid
    later anyway, apps.payments flags it for a refund."""
    Payment.objects.filter(booking_id__in=booking_ids, status__in=OPEN_PAYMENT_STATUSES).update(
        status=PaymentStatus.CANCELLED, failure_reason=reason, updated_at=now
    )


def _flag_refunds(booking_ids, now) -> None:
    """These bookings were paid for but won't be travelled: their payments need refunding."""
    Payment.objects.filter(
        booking_id__in=booking_ids, status__in=REFUNDABLE_PAYMENT_STATUSES
    ).update(requires_refund=True, updated_at=now)


# ---------------------------------------------------------------------------
# Seat locks
# ---------------------------------------------------------------------------
@transaction.atomic
def lock_seats(*, trip_id, customer, seat_numbers) -> list[SeatLock]:
    """
    Lock seats for `customer`: all of them or none. Every lock a customer has on a trip shares
    one expiry, set when the first seat was locked, so adding seats never extends the hold.
    """
    numbers = list(dict.fromkeys(normalize_seat(n) for n in seat_numbers if str(n).strip()))
    if not numbers:
        raise ValidationError({"seats": ["Choose at least one seat."]})

    trip = _lock_trip(trip_id, bookable=True)
    now = timezone.now()
    _release_stale(trip, now)

    layout = {normalize_seat(seat.seat_number): seat for seat in trip.bus.seat_layout.seats.all()}
    unknown = [number for number in numbers if number not in layout]
    if unknown:
        raise ValidationError({"seats": [f"Seat {_seat_list(unknown)} doesn’t exist on this bus."]})

    for_sale = {normalize_seat(seat.seat_number) for seat in sellable_seats(trip)}
    held = _held_seats(trip, now)
    locks = {normalize_seat(lock.seat_number): lock for lock in SeatLock.objects.filter(trip=trip)}
    taken = {}
    for number in numbers:
        lock = locks.get(number)
        if number in held:
            taken[number] = "booked"
        elif lock is not None and lock.customer_id != customer.pk:
            taken[number] = "locked"
        elif number not in for_sale:
            taken[number] = "blocked"
    if taken:
        raise SeatsUnavailable(taken)

    mine = [lock for lock in locks.values() if lock.customer_id == customer.pk]
    already = {normalize_seat(lock.seat_number) for lock in mine}
    new = [number for number in numbers if number not in already]
    if len(mine) + len(new) > MAX_SEATS_PER_TRIP:
        raise ValidationError(
            {"seats": [f"You can hold up to {MAX_SEATS_PER_TRIP} seats on one trip."]}
        )

    expires_at = min((lock.expires_at for lock in mine), default=now + lock_duration())
    try:
        with transaction.atomic():
            SeatLock.objects.bulk_create(
                SeatLock(trip=trip, customer=customer, seat_number=number, expires_at=expires_at)
                for number in new
            )
    except IntegrityError as exc:  # unreachable while the trip lock is held; kept as a guard
        if violated_constraint(exc) == SEAT_LOCK_CONSTRAINT:
            raise SeatsUnavailable(dict.fromkeys(new, "locked")) from exc
        raise
    if new:
        log_event(
            "seat.locked",
            trip_id=str(trip.pk),
            customer_id=str(customer.pk),
            seats=new,
            expires_at=expires_at,
        )
    return active_locks(trip, customer, now)


@transaction.atomic
def release_locks(*, trip_id, customer, seat_numbers=None) -> None:
    """Give back some (or all) of a customer's locked seats on a trip."""
    trip = _lock_trip(trip_id, bookable=False)
    locks = SeatLock.objects.filter(trip=trip, customer=customer)
    if seat_numbers is not None:
        locks = locks.filter(seat_number__in=[normalize_seat(n) for n in seat_numbers])
    locks.delete()


def active_locks(trip: Trip, customer, now=None) -> list[SeatLock]:
    locks = SeatLock.objects.filter(
        trip=trip, customer=customer, expires_at__gt=now or timezone.now()
    )
    return sorted(locks, key=lambda lock: seat_sort_key(lock.seat_number))


def hold_summary(trip: Trip, customer, now=None) -> dict:
    """The customer's current hold on a trip: locked seats, countdown and price."""
    now = now or timezone.now()
    locks = active_locks(trip, customer, now)
    expires_at = min((lock.expires_at for lock in locks), default=None)
    return {
        "trip": str(trip.pk),
        "seats": [
            {"id": str(lock.pk), "seat_number": lock.seat_number, "expires_at": lock.expires_at}
            for lock in locks
        ],
        "expires_at": expires_at,
        "seconds_remaining": max(0, int((expires_at - now).total_seconds())) if expires_at else 0,
        "lock_minutes": int(lock_duration().total_seconds() // 60),
        "quote": pricing.quote(trip, len(locks), customer).as_dict() if locks else None,
    }


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------
def _journey(trip: Trip, boarding_stop_id, dropoff_stop_id, now) -> tuple[TripStop, TripStop]:
    stops = {stop.stop_id: stop for stop in trip.trip_stops.select_related("stop")}
    boarding, dropoff = stops.get(boarding_stop_id), stops.get(dropoff_stop_id)
    errors = {}
    if boarding is None or not boarding.is_boarding_point or not boarding.stop.active:
        errors["boarding_stop"] = ["Choose one of this trip’s boarding points."]
    elif boarding.departure_datetime <= now:
        errors["boarding_stop"] = ["The bus has already left this stop."]
    if dropoff is None or not dropoff.is_dropoff_point or not dropoff.stop.active:
        errors["dropoff_stop"] = ["Choose one of this trip’s drop-off points."]
    elif boarding is not None and dropoff.sequence <= boarding.sequence:
        errors["dropoff_stop"] = ["Your drop-off point must come after your boarding point."]
    if errors:
        raise ValidationError(errors)
    return boarding, dropoff


@transaction.atomic
def create_booking(
    *, customer, trip_id, boarding_stop_id, dropoff_stop_id, passengers: list[dict]
) -> Booking:
    """
    Turn the customer's locked seats into a pending booking. The seats must be locked by this
    customer right now; the booking keeps the locks' expiry as its own hold expiry.
    """
    seats = [normalize_seat(passenger["seat_number"]) for passenger in passengers]
    if not seats:
        raise ValidationError({"passengers": ["Add a passenger for each seat."]})
    if len(set(seats)) != len(seats):
        raise ValidationError({"passengers": ["Each passenger needs a different seat."]})
    if len(seats) > MAX_SEATS_PER_TRIP:
        raise ValidationError(
            {"passengers": [f"You can book up to {MAX_SEATS_PER_TRIP} seats at a time."]}
        )

    trip = _lock_trip(trip_id, bookable=True)
    now = timezone.now()
    _release_stale(trip, now)

    locks = {
        normalize_seat(lock.seat_number): lock
        for lock in SeatLock.objects.filter(
            trip=trip, customer=customer, seat_number__in=seats, expires_at__gt=now
        )
    }
    missing = [seat for seat in seats if seat not in locks]
    if missing:
        raise HoldExpired(
            f"Your hold on seat {_seat_list(missing)} has run out. Please choose your seats again.",
            details={"seats": dict.fromkeys(missing, "not_held")},
        )

    boarding, dropoff = _journey(trip, boarding_stop_id, dropoff_stop_id, now)
    price = pricing.quote(trip, len(seats), customer)
    booking = Booking.objects.create(
        customer=customer,
        trip=trip,
        status=BookingStatus.PENDING,
        boarding_stop_id=boarding.stop_id,
        dropoff_stop_id=dropoff.stop_id,
        boarding_time=boarding.departure_datetime,
        dropoff_time=dropoff.arrival_datetime,
        unit_price=price.unit_price,
        subtotal=price.subtotal,
        service_fee=price.service_fee,
        discount=price.discount,
        tax=price.tax,
        total_amount=price.total,
        currency=price.currency,
        expires_at=min(lock.expires_at for lock in locks.values()),
    )
    Passenger.objects.bulk_create(
        Passenger(
            booking=booking,
            trip=trip,
            seat_number=seat,
            name=details["name"],
            phone=details["phone"],
            email=details.get("email", ""),
        )
        for seat, details in zip(seats, passengers, strict=True)
    )
    SeatLock.objects.filter(pk__in=[lock.pk for lock in locks.values()]).delete()
    if not customer.name.strip():
        # Accounts made with just a phone number take their name from the first booking.
        customer.name = passengers[0]["name"]
        customer.save(update_fields=["name", "updated_at"])
    log_event(
        "booking.created",
        booking_id=str(booking.pk),
        booking_reference=booking.booking_reference,
        customer_id=str(customer.pk),
        trip_id=str(trip.pk),
        seats=seats,
        amount=f"{booking.total_amount:.2f}",
        currency=booking.currency,
    )
    return booking


def _ensure_open(booking: Booking) -> None:
    if booking.status == BookingStatus.EXPIRED:
        raise HoldExpired("Your seat hold has run out. Please choose your seats again.")
    if booking.status not in UNPAID_STATUSES:
        raise Conflict(f"This booking is already {booking.get_status_display().lower()}.")


def _confirm(booking: Booking, now) -> None:
    """Paid: the held seats become the customer's, and the e-ticket is issued."""
    booking.status = BookingStatus.CONFIRMED
    booking.confirmed_at = now
    booking.save(update_fields=["status", "confirmed_at", "updated_at"])
    ticket = issue_ticket(booking, now)
    # Queued in this transaction, sent once it commits: the ticket by SMS and e-mail.
    notify_booking_confirmed(booking)
    log_event(
        "booking.confirmed",
        booking_id=str(booking.pk),
        booking_reference=booking.booking_reference,
        customer_id=str(booking.customer_id),
        trip_id=str(booking.trip_id),
        ticket_number=getattr(ticket, "ticket_number", None),
    )


def _cancel(booking: Booking, reason: str, now) -> None:
    booking.status = BookingStatus.CANCELLED
    booking.cancelled_at = now
    booking.cancellation_reason = reason
    booking.save(update_fields=["status", "cancelled_at", "cancellation_reason", "updated_at"])
    booking.passengers.update(holds_seat=False, updated_at=now)


@_swept
def update_passengers(booking: Booking, passengers: list[dict]) -> Booking:
    """Correct passenger details before the booking is submitted for payment."""
    locked = _lock_booking(booking)
    _release_stale(locked.trip, timezone.now())
    locked.refresh_from_db()
    _ensure_open(locked)
    if locked.status != BookingStatus.PENDING:
        raise Conflict("Passenger details can’t change once the booking is sent for payment.")
    current = {normalize_seat(p.seat_number): p for p in locked.passengers.all()}
    given = {normalize_seat(p["seat_number"]): p for p in passengers}
    if set(given) != set(current) or len(given) != len(passengers):
        raise ValidationError({"passengers": ["Give details for each booked seat, once each."]})
    for seat, details in given.items():
        passenger = current[seat]
        passenger.name, passenger.phone, passenger.email = (
            details["name"],
            details["phone"],
            details.get("email", ""),
        )
        passenger.save(update_fields=["name", "phone", "email", "updated_at"])
    return locked


@_swept
def submit_for_payment(booking: Booking) -> Booking:
    """The customer has reviewed the booking: it now waits for payment (seats stay held)."""
    locked = _lock_booking(booking)
    _release_stale(locked.trip, timezone.now())
    locked.refresh_from_db()
    _ensure_open(locked)
    if locked.status != BookingStatus.PENDING:
        raise Conflict("This booking is already waiting for payment.")
    locked.status = BookingStatus.PAYMENT_PENDING
    locked.save(update_fields=["status", "updated_at"])
    log_event(
        "booking.checkout",
        booking_id=str(locked.pk),
        booking_reference=locked.booking_reference,
        amount=f"{locked.total_amount:.2f}",
    )
    return locked


@_swept
def confirm_payment(booking: Booking, *, method: str = PaymentMethod.CASH) -> Booking:
    """
    Staff took the money themselves (e.g. cash at the counter): record it and confirm the
    booking. Refused when the hold ran out first, because the seats may belong to someone else.
    """
    locked = _lock_booking(booking)
    now = timezone.now()
    _release_stale(locked.trip, now)
    locked.refresh_from_db()
    _ensure_open(locked)
    _close_open_payments([locked.pk], "Paid at the counter instead.", now)
    if locked.total_amount > 0:
        Payment.objects.create(
            booking=locked,
            provider=MANUAL_PROVIDER,
            amount=locked.total_amount,
            currency=locked.currency,
            status=PaymentStatus.SUCCESSFUL,
            payment_method=method,
            paid_at=now,
        )
    _confirm(locked, now)
    log_event(
        "payment.recorded",
        booking_id=str(locked.pk),
        booking_reference=locked.booking_reference,
        provider=MANUAL_PROVIDER,
        method=method,
        amount=f"{locked.total_amount:.2f}",
    )
    return locked


def _refund_breakdown(decision) -> dict:
    """The policy numbers behind a refund, frozen so a later policy change can't rewrite it."""
    hours = decision.hours_before_departure
    return {
        "source": "cancellation_policy",
        "refund_percent": f"{decision.refund_percent.normalize():f}",
        "fee": f"{decision.fee:.2f}",
        "paid_amount": f"{decision.paid_amount:.2f}",
        "hours_before_departure": None if hours is None else round(float(hours), 1),
    }


@_swept
def cancel_booking(
    booking: Booking, *, reason: str = "", allow_paid: bool = False, actor=None
) -> Booking:
    """
    Cancel a booking under the cancellation policy: free the seats, record when and why, and
    raise a refund request for whatever the policy gives back. `allow_paid` is the support
    team's override — they may cancel outside the rules, and the customer gets everything back.
    """
    locked = _lock_booking(booking)
    now = timezone.now()
    _release_stale(locked.trip, now)
    locked.refresh_from_db()
    decision = cancellation.quote(locked, now=now, staff=allow_paid)
    if not decision.allowed:
        raise Conflict(
            decision.message,
            code="cancellation_not_allowed",
            details={"cancellation": decision.as_dict()},
        )
    was_paid = locked.status in PAID_STATUSES
    _close_open_payments([locked.pk], "The booking was cancelled.", now)
    _cancel(locked, reason, now)
    if was_paid and decision.refund_amount > 0:
        _flag_refunds([locked.pk], now)
        refund_requests.request_refund(
            locked,
            amount=decision.refund_amount,
            reason=reason or "The customer cancelled this booking.",
            requested_by=actor,
            breakdown=_refund_breakdown(decision),
        )
    log_event(
        "booking.cancelled",
        booking_id=str(locked.pk),
        booking_reference=locked.booking_reference,
        customer_id=str(locked.customer_id),
        by_staff=allow_paid,
        actor_id=str(actor.pk) if actor is not None and actor.pk else None,
        was_paid=was_paid,
        refund_amount=f"{decision.refund_amount:.2f}",
        reason=reason,
    )
    return locked


# ---------------------------------------------------------------------------
# Payment hooks (apps.payments calls these inside its own transaction)
# ---------------------------------------------------------------------------
def lock_for_payment(booking_id) -> Booking:
    """Lock the booking's trip and then the booking, clear the trip's stale holds, and return
    the fresh booking (with what gateways need to know about the customer)."""
    trip_id = Booking.objects.values_list("trip_id", flat=True).get(pk=booking_id)
    trip = _lock_trip(trip_id, bookable=False)
    _release_stale(trip, timezone.now())
    return (
        Booking.objects.select_for_update(of=("self",))
        .select_related("trip__bus__seat_layout", "customer", "boarding_stop")
        .get(pk=booking_id)
    )


def hold_for_payment(booking: Booking, now) -> Booking:
    """
    The customer is paying: the booking waits for payment and keeps its seats for the payment
    window — but never longer than PAYMENT_MAX_HOLD_MINUTES after it was made, so a customer
    can't hold seats indefinitely by starting payments. Call sweep_trip() first.
    """
    locked = lock_for_payment(booking.pk)
    _ensure_open(locked)
    fields = []
    if locked.status == BookingStatus.PENDING:
        locked.status = BookingStatus.PAYMENT_PENDING
        fields.append("status")
    window = now + timedelta(minutes=settings.PAYMENT_WINDOW_MINUTES)
    limit = locked.created_at + timedelta(minutes=settings.PAYMENT_MAX_HOLD_MINUTES)
    extended = min(window, limit)
    if locked.expires_at is None or extended > locked.expires_at:
        locked.expires_at = extended
        fields.append("expires_at")
    if fields:
        locked.save(update_fields=[*fields, "updated_at"])
    return locked


def _reinstate(booking: Booking, now) -> bool:
    """Take an expired booking's seats back, if the trip is still on sale and nobody else has
    them (booked, or locked by another customer)."""
    trip = booking.trip
    if booking.boarding_time and booking.boarding_time <= now:
        return False
    if not bookable_trips().filter(pk=trip.pk).exists():
        return False
    seats = [normalize_seat(p.seat_number) for p in booking.passengers.all()]
    taken = _held_seats(trip, now)
    locked_by_others = {
        normalize_seat(number)
        for number in SeatLock.objects.filter(trip=trip, expires_at__gt=now)
        .exclude(customer_id=booking.customer_id)
        .values_list("seat_number", flat=True)
    }
    for_sale = {normalize_seat(seat.seat_number) for seat in sellable_seats(trip)}
    if any(seat in taken or seat in locked_by_others or seat not in for_sale for seat in seats):
        return False
    # The customer may have started choosing these seats again; the paid booking wins.
    SeatLock.objects.filter(
        trip=trip, customer_id=booking.customer_id, seat_number__in=seats
    ).delete()
    try:
        with transaction.atomic():
            booking.passengers.update(holds_seat=True, updated_at=now)
    except IntegrityError as exc:  # unreachable while the trip lock is held; kept as a guard
        if violated_constraint(exc) == HELD_SEAT_CONSTRAINT:
            return False
        raise
    return True


def settle_payment(booking: Booking, now) -> tuple[bool, str]:
    """
    A payment for this booking succeeded (the caller holds the locks from lock_for_payment).
    Confirm the booking — if its hold had already run out, only when the seats can be taken
    back. Returns (confirmed, why not).
    """
    if booking.status in PAID_STATUSES:
        return False, "The booking had already been paid for."
    if booking.status == BookingStatus.CANCELLED:
        return False, "The booking was cancelled before the payment arrived."
    if booking.status == BookingStatus.EXPIRED and not _reinstate(booking, now):
        return False, "The payment arrived after the seat hold ran out and the seats were gone."
    _confirm(booking, now)
    return True, ""


def release_refunded(booking: Booking, reason: str, now) -> bool:
    """The booking's payment was refunded in full: cancel it and free the seats."""
    if booking.status != BookingStatus.CONFIRMED:
        return False
    _close_open_payments([booking.pk], "The booking was refunded.", now)
    _cancel(booking, reason, now)
    return True


# ---------------------------------------------------------------------------
# Trip life cycle (called from apps.trips.services inside the trip's transaction)
# ---------------------------------------------------------------------------
def cancel_trip_bookings(trip: Trip, reason: str = "") -> int:
    """The trip was cancelled: cancel every live booking, free all seats and drop locks. Paid
    bookings' payments are flagged for refund."""
    now = timezone.now()
    live = list(
        Booking.objects.select_for_update()
        .filter(trip=trip)
        .exclude(status__in=(*RELEASED_STATUSES, BookingStatus.COMPLETED))
        .values_list("pk", flat=True)
    )
    if live:
        Booking.objects.filter(pk__in=live).update(
            status=BookingStatus.CANCELLED,
            cancelled_at=now,
            cancellation_reason=reason or "The trip was cancelled by the operator.",
            updated_at=now,
        )
        Passenger.objects.filter(booking_id__in=live).update(holds_seat=False, updated_at=now)
        _flag_refunds(live, now)
        _close_open_payments(live, "The trip was cancelled.", now)
        _request_trip_refunds(live, reason, now)
    SeatLock.objects.filter(trip=trip).delete()
    return len(live)


def _request_trip_refunds(booking_ids, reason: str, now) -> None:
    """The operator cancelled the trip: everyone who paid gets their money back in full."""
    paid = Booking.objects.filter(pk__in=booking_ids).prefetch_related("payments")
    for booking in paid:
        owed = cancellation.amount_paid(booking)
        if owed > 0:
            refund_requests.request_refund(
                booking,
                amount=owed,
                reason=reason or "The trip was cancelled by the operator.",
                breakdown={"source": "trip_cancelled", "refund_percent": "100"},
            )


def complete_trip_bookings(trip: Trip) -> None:
    """The journey is over: paid bookings are completed, unpaid ones expire."""
    now = timezone.now()
    Booking.objects.filter(trip=trip, status=BookingStatus.CONFIRMED).update(
        status=BookingStatus.COMPLETED, updated_at=now
    )
    unpaid = list(
        Booking.objects.filter(trip=trip, status__in=UNPAID_STATUSES).values_list("pk", flat=True)
    )
    if unpaid:
        Booking.objects.filter(pk__in=unpaid).update(status=BookingStatus.EXPIRED, updated_at=now)
        Passenger.objects.filter(booking_id__in=unpaid).update(holds_seat=False, updated_at=now)
    SeatLock.objects.filter(trip=trip).delete()
