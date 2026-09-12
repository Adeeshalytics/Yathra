from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, models, transaction
from django.db.models import Q

from apps.core.db import violated_constraint
from apps.core.fields import PhoneNumberField
from apps.core.models import BaseModel
from apps.routes.models import Stop
from apps.trips.models import Trip

from .references import generate_booking_reference

REFERENCE_CONSTRAINT = "bookings_booking_reference_unique"
SEAT_LOCK_CONSTRAINT = "bookings_seatlock_seat_unique"
HELD_SEAT_CONSTRAINT = "bookings_passenger_seat_held_once"
MAX_REFERENCE_ATTEMPTS = 5


class BookingStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PAYMENT_PENDING = "payment_pending", "Payment pending"
    CONFIRMED = "confirmed", "Confirmed"
    CANCELLED = "cancelled", "Cancelled"
    EXPIRED = "expired", "Expired"
    COMPLETED = "completed", "Completed"


# Unpaid bookings hold their seats only until `expires_at`; paid ones keep them.
UNPAID_STATUSES = (BookingStatus.PENDING, BookingStatus.PAYMENT_PENDING)
PAID_STATUSES = (BookingStatus.CONFIRMED, BookingStatus.COMPLETED)
RELEASED_STATUSES = (BookingStatus.CANCELLED, BookingStatus.EXPIRED)


def booking_holds_seats(now, prefix: str = "") -> Q:
    """Bookings whose seats are taken at `now` (paid, or unpaid with a hold that hasn't run out)."""
    unpaid = Q(**{f"{prefix}status__in": UNPAID_STATUSES}) & (
        Q(**{f"{prefix}expires_at__isnull": True}) | Q(**{f"{prefix}expires_at__gt": now})
    )
    return Q(**{f"{prefix}status__in": PAID_STATUSES}) | unpaid


def passenger_holds_seat(now) -> Q:
    """Passengers occupying their seat at `now`."""
    return Q(holds_seat=True) & booking_holds_seats(now, prefix="booking__")


class Booking(BaseModel):
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bookings"
    )
    trip = models.ForeignKey(Trip, on_delete=models.PROTECT, related_name="bookings")
    booking_reference = models.CharField(max_length=16, editable=False)
    status = models.CharField(
        max_length=16, choices=BookingStatus.choices, default=BookingStatus.PENDING
    )
    boarding_stop = models.ForeignKey(
        Stop, on_delete=models.PROTECT, related_name="boarding_bookings", null=True, blank=True
    )
    dropoff_stop = models.ForeignKey(
        Stop, on_delete=models.PROTECT, related_name="dropoff_bookings", null=True, blank=True
    )
    boarding_time = models.DateTimeField(null=True, blank=True)
    dropoff_time = models.DateTimeField(null=True, blank=True)
    # Price breakdown, calculated by apps.bookings.pricing when the booking is made.
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    service_fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    tax = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default=settings.DEFAULT_CURRENCY)
    expires_at = models.DateTimeField(
        null=True, blank=True, help_text="When an unpaid booking's seat hold runs out."
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["customer", "-created_at"], name="bookings_customer_recent_idx"),
            models.Index(fields=["trip", "status"], name="bookings_trip_status_idx"),
            models.Index(fields=["status", "expires_at"], name="bookings_status_expiry_idx"),
            # The admin list and the booking report read every customer's bookings, newest first.
            models.Index(fields=["-created_at"], name="bookings_recent_idx"),
            # The cancellation report: cancelled bookings within a date range.
            models.Index(fields=["status", "cancelled_at"], name="bookings_cancelled_at_idx"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["booking_reference"], name=REFERENCE_CONSTRAINT),
            models.CheckConstraint(
                condition=Q(total_amount__gte=0), name="bookings_booking_total_non_negative"
            ),
            models.CheckConstraint(
                condition=Q(
                    unit_price__gte=0,
                    subtotal__gte=0,
                    service_fee__gte=0,
                    discount__gte=0,
                    tax__gte=0,
                ),
                name="bookings_booking_amounts_non_negative",
            ),
            models.CheckConstraint(
                condition=Q(status__in=BookingStatus.values), name="bookings_booking_status_valid"
            ),
        ]

    def __str__(self) -> str:
        return self.booking_reference

    def save(self, *args, **kwargs):
        if self.booking_reference:
            return super().save(*args, **kwargs)

        # Collisions are astronomically unlikely, but the unique constraint is the real guard:
        # retry inside a savepoint so a clash never poisons the caller's transaction.
        for attempt in range(1, MAX_REFERENCE_ATTEMPTS + 1):
            self.booking_reference = generate_booking_reference()
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError as exc:
                self.booking_reference = ""
                if (
                    violated_constraint(exc) != REFERENCE_CONSTRAINT
                    or attempt == MAX_REFERENCE_ATTEMPTS
                ):
                    raise
        return None


class Passenger(BaseModel):
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="passengers")
    # A copy of booking.trip so the database itself can allow each seat once per trip.
    trip = models.ForeignKey(Trip, on_delete=models.PROTECT, related_name="passengers")
    name = models.CharField(max_length=150)
    phone = PhoneNumberField(blank=True)
    email = models.EmailField(max_length=254, blank=True)
    seat_number = models.CharField(max_length=8)
    holds_seat = models.BooleanField(
        default=True, help_text="Cleared when the booking is cancelled or expires."
    )
    boarded_at = models.DateTimeField(
        null=True, blank=True, help_text="When the crew checked this passenger onto the bus."
    )

    class Meta:
        ordering = ["seat_number"]
        indexes = [
            models.Index(fields=["trip", "holds_seat"], name="bookings_passenger_trip_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["booking", "seat_number"], name="bookings_passenger_seat_unique"
            ),
            # The last line of defence against double booking.
            models.UniqueConstraint(
                fields=["trip", "seat_number"],
                condition=Q(holds_seat=True),
                name=HELD_SEAT_CONSTRAINT,
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} (seat {self.seat_number})"

    @property
    def boarding_status(self) -> str:
        """What the crew sees on the manifest: boarded, still expected, or no longer travelling."""
        if self.boarded_at:
            return "boarded"
        return "expected" if self.holds_seat else "released"

    def save(self, *args, **kwargs):
        if self.trip_id is None and self.booking_id is not None:
            self.trip_id = self.booking.trip_id
        if self._state.adding and self.booking_id and self.booking.status in RELEASED_STATUSES:
            self.holds_seat = False
        super().save(*args, **kwargs)


class SeatLock(BaseModel):
    """
    A customer's temporary hold on one seat of one trip while they book it (5 minutes by
    default). Only one lock per seat and trip can exist; expired locks don't count and are
    cleared before the trip's seats next change.
    """

    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="seat_locks")
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="seat_locks"
    )
    seat_number = models.CharField(max_length=8)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["trip", "seat_number"]
        indexes = [
            models.Index(fields=["trip", "expires_at"], name="bookings_seatlock_trip_exp_idx"),
            models.Index(fields=["customer", "trip"], name="bookings_seatlock_customer_idx"),
            models.Index(fields=["expires_at"], name="bookings_seatlock_expiry_idx"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["trip", "seat_number"], name=SEAT_LOCK_CONSTRAINT),
        ]

    def __str__(self) -> str:
        return f"Seat {self.seat_number} held until {self.expires_at:%H:%M:%S}"
