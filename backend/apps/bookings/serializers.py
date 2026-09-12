from django.core.exceptions import ObjectDoesNotExist
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import UserRole
from apps.core.validators import normalize_phone_number
from apps.payments.models import PaymentMethod
from apps.payments.serializers import RefundSerializer
from apps.trips.models import Trip
from apps.trips.public_serializers import (
    PublicOperatorSerializer,
    PublicRouteSerializer,
    PublicStopSerializer,
)

from . import cancellation as cancellation_policy
from .models import UNPAID_STATUSES, Booking, Passenger
from .services import MAX_SEATS_PER_TRIP, seat_sort_key


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------
class PassengerInputSerializer(serializers.Serializer):
    seat_number = serializers.CharField(max_length=8)
    name = serializers.CharField(
        max_length=150, error_messages={"blank": "Enter the passenger’s full name."}
    )
    phone = serializers.CharField(
        max_length=32, error_messages={"blank": "Enter a phone number for this passenger."}
    )
    email = serializers.EmailField(
        max_length=254,
        error_messages={
            "blank": "Enter an email address for this passenger.",
            "invalid": "Enter a valid email address.",
        },
    )

    def validate_name(self, value: str) -> str:
        name = " ".join(value.split())
        if len(name) < 2:
            raise serializers.ValidationError("Enter the passenger’s full name.")
        return name

    def validate_phone(self, value: str) -> str:
        try:
            return normalize_phone_number(value)
        except (DjangoValidationError, ValueError):
            raise serializers.ValidationError(
                "Enter a valid phone number, e.g. 077 123 4567."
            ) from None

    def validate_email(self, value: str) -> str:
        return value.strip().lower()


class BookingCreateSerializer(serializers.Serializer):
    trip = serializers.UUIDField()
    boarding_stop = serializers.UUIDField()
    dropoff_stop = serializers.UUIDField()
    passengers = PassengerInputSerializer(
        many=True, allow_empty=False, max_length=MAX_SEATS_PER_TRIP
    )


class PassengerUpdateSerializer(serializers.Serializer):
    passengers = PassengerInputSerializer(
        many=True, allow_empty=False, max_length=MAX_SEATS_PER_TRIP
    )


class CancelBookingSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class ConfirmPaymentSerializer(serializers.Serializer):
    payment_method = serializers.ChoiceField(
        choices=PaymentMethod.choices, default=PaymentMethod.CASH
    )


class SeatLockRequestSerializer(serializers.Serializer):
    trip = serializers.UUIDField()
    seats = serializers.ListField(
        child=serializers.CharField(max_length=8),
        allow_empty=False,
        max_length=MAX_SEATS_PER_TRIP,
    )


class SeatReleaseSerializer(serializers.Serializer):
    trip = serializers.UUIDField()
    seats = serializers.ListField(
        child=serializers.CharField(max_length=8), required=False, max_length=MAX_SEATS_PER_TRIP
    )


class HoldQuerySerializer(serializers.Serializer):
    trip = serializers.UUIDField(error_messages={"required": "Say which trip (?trip=…)."})


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
class PassengerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Passenger
        fields = ["id", "seat_number", "name", "phone", "email"]
        read_only_fields = fields


class BookingTripSerializer(serializers.ModelSerializer):
    route = PublicRouteSerializer(read_only=True)
    operator = PublicOperatorSerializer(read_only=True)
    bus = serializers.SerializerMethodField()
    arrival_datetime = serializers.DateTimeField(
        source="estimated_arrival_datetime", read_only=True
    )

    class Meta:
        model = Trip
        fields = [
            "id",
            "code",
            "status",
            "route",
            "operator",
            "bus",
            "departure_datetime",
            "arrival_datetime",
        ]
        read_only_fields = fields

    def get_bus(self, trip: Trip) -> dict:
        return {
            "name": trip.bus.name,
            "registration_number": trip.bus.registration_number,
            "bus_type": trip.bus.bus_type,
            "bus_type_label": trip.bus.get_bus_type_display(),
        }


class BookingSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    customer = serializers.SerializerMethodField()
    trip = BookingTripSerializer(read_only=True)
    boarding = serializers.SerializerMethodField()
    dropoff = serializers.SerializerMethodField()
    seats = serializers.SerializerMethodField()
    passengers = PassengerSerializer(many=True, read_only=True)
    price = serializers.SerializerMethodField()
    seconds_remaining = serializers.SerializerMethodField()
    ticket = serializers.SerializerMethodField()
    payment = serializers.SerializerMethodField(help_text="The latest payment attempt, if any.")
    cancellation = serializers.SerializerMethodField(
        help_text="Whether this booking can be cancelled now, and what the policy gives back."
    )
    refunds = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id",
            "booking_reference",
            "status",
            "status_label",
            "customer",
            "trip",
            "boarding",
            "dropoff",
            "seats",
            "passengers",
            "price",
            "total_amount",
            "currency",
            "expires_at",
            "seconds_remaining",
            "ticket",
            "payment",
            "cancellation",
            "refunds",
            "confirmed_at",
            "cancelled_at",
            "cancellation_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def _point(self, stop, time) -> dict | None:
        if stop is None:
            return None
        return {
            "stop": PublicStopSerializer(stop).data,
            "time": serializers.DateTimeField().to_representation(time) if time else None,
        }

    def get_customer(self, booking: Booking) -> dict:
        return {
            "id": str(booking.customer_id),
            "name": booking.customer.name,
            "email": booking.customer.email,
        }

    def get_boarding(self, booking: Booking) -> dict | None:
        return self._point(booking.boarding_stop, booking.boarding_time)

    def get_dropoff(self, booking: Booking) -> dict | None:
        return self._point(booking.dropoff_stop, booking.dropoff_time)

    def get_seats(self, booking: Booking) -> list[str]:
        return sorted((p.seat_number for p in booking.passengers.all()), key=seat_sort_key)

    def get_price(self, booking: Booking) -> dict:
        return {
            "currency": booking.currency,
            "unit_price": str(booking.unit_price),
            "seats": len(booking.passengers.all()),
            "subtotal": str(booking.subtotal),
            "service_fee": str(booking.service_fee),
            "discount": str(booking.discount),
            "tax": str(booking.tax),
            "total": str(booking.total_amount),
        }

    def get_seconds_remaining(self, booking: Booking) -> int | None:
        if booking.status not in UNPAID_STATUSES or booking.expires_at is None:
            return None
        return max(0, int((booking.expires_at - timezone.now()).total_seconds()))

    def get_ticket(self, booking: Booking) -> dict | None:
        try:
            ticket = booking.ticket
        except ObjectDoesNotExist:
            return None
        return {
            "ticket_number": ticket.ticket_number,
            "status": ticket.status,
            "issued_at": serializers.DateTimeField().to_representation(ticket.issued_at),
        }

    def _viewer_is_staff(self) -> bool:
        request = self.context.get("request")
        return getattr(getattr(request, "user", None), "role", None) == UserRole.ADMIN

    def get_cancellation(self, booking: Booking) -> dict:
        decision = cancellation_policy.quote(booking, staff=self._viewer_is_staff()).as_dict()
        # The policy wording itself comes from /bookings/{id}/cancellation/, not every row.
        decision.pop("rules", None)
        deadline = decision["deadline"]
        decision["deadline"] = (
            serializers.DateTimeField().to_representation(deadline) if deadline else None
        )
        return decision

    def get_refunds(self, booking: Booking) -> list[dict]:
        return RefundSerializer(booking.refunds.all(), many=True).data

    def get_payment(self, booking: Booking) -> dict | None:
        payment = max(booking.payments.all(), key=lambda p: p.created_at, default=None)
        if payment is None:
            return None
        return {
            "id": str(payment.pk),
            "status": payment.status,
            "status_label": payment.get_status_display(),
            "provider": payment.provider,
            "failure_reason": payment.failure_reason,
            "requires_refund": payment.requires_refund,
            "created_at": serializers.DateTimeField().to_representation(payment.created_at),
        }
