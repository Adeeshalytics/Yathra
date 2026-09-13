from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.bookings.serializers import BookingSerializer
from apps.bookings.services import seat_sort_key
from apps.core.validators import normalize_phone_number
from apps.payments.models import CAPTURED_PAYMENT_STATUSES
from apps.payments.providers import provider_label

from .models import Ticket, TicketStatus
from .qr import qr_data_uri, ticket_code


def paying_payment(booking):
    """The captured payment behind a booking (latest first), from prefetched payments."""
    captured = [p for p in booking.payments.all() if p.status in CAPTURED_PAYMENT_STATUSES]
    return max(captured, key=lambda p: p.paid_at, default=None)


class TicketSerializer(serializers.ModelSerializer):
    """The customer's e-ticket: the booking plus the ticket number and its signed QR code."""

    status = serializers.CharField(read_only=True)
    status_label = serializers.SerializerMethodField()
    is_valid = serializers.BooleanField(read_only=True)
    qr_code = serializers.SerializerMethodField(help_text="A data: URI of the QR code (SVG).")
    share_url = serializers.CharField(
        read_only=True, help_text="The ticket's own link: opens without signing in."
    )
    booking = BookingSerializer(read_only=True)
    payment = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "ticket_number",
            "status",
            "status_label",
            "is_valid",
            "issued_at",
            "qr_code",
            "share_url",
            "booking",
            "payment",
        ]
        read_only_fields = fields

    def get_status_label(self, ticket: Ticket) -> str:
        return TicketStatus(ticket.status).label

    def get_qr_code(self, ticket: Ticket) -> str:
        return qr_data_uri(ticket_code(ticket.ticket_number))

    def get_payment(self, ticket: Ticket) -> dict | None:
        payment = paying_payment(ticket.booking)
        if payment is None:
            return None
        return {
            "transaction_reference": payment.transaction_reference,
            "provider_name": provider_label(payment.provider),
            "payment_method_label": payment.get_payment_method_display(),
            "amount": f"{payment.amount:.2f}",
            "currency": payment.currency,
            "paid_at": serializers.DateTimeField().to_representation(payment.paid_at),
        }


class TicketCheckSerializer(serializers.ModelSerializer):
    """What a conductor or admin sees after scanning a ticket. No phone numbers or emails."""

    status = serializers.CharField(read_only=True)
    status_label = serializers.SerializerMethodField()
    is_valid = serializers.BooleanField(read_only=True)
    booking_reference = serializers.CharField(source="booking.booking_reference", read_only=True)
    trip = serializers.SerializerMethodField()
    boarding = serializers.SerializerMethodField()
    dropoff = serializers.SerializerMethodField()
    passengers = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "ticket_number",
            "status",
            "status_label",
            "is_valid",
            "issued_at",
            "booking_reference",
            "trip",
            "boarding",
            "dropoff",
            "passengers",
        ]
        read_only_fields = fields

    def get_status_label(self, ticket: Ticket) -> str:
        return TicketStatus(ticket.status).label

    def get_trip(self, ticket: Ticket) -> dict:
        trip = ticket.booking.trip
        return {
            "id": str(trip.pk),
            "code": trip.code,
            "route": trip.route.name,
            "bus": trip.bus.registration_number,
            "departure_datetime": serializers.DateTimeField().to_representation(
                trip.departure_datetime
            ),
        }

    @staticmethod
    def _point(stop, time) -> dict | None:
        if stop is None:
            return None
        return {
            "name": stop.name,
            "time": serializers.DateTimeField().to_representation(time) if time else None,
        }

    def get_boarding(self, ticket: Ticket) -> dict | None:
        return self._point(ticket.booking.boarding_stop, ticket.booking.boarding_time)

    def get_dropoff(self, ticket: Ticket) -> dict | None:
        return self._point(ticket.booking.dropoff_stop, ticket.booking.dropoff_time)

    def get_passengers(self, ticket: Ticket) -> list[dict]:
        passengers = sorted(
            ticket.booking.passengers.all(), key=lambda p: seat_sort_key(p.seat_number)
        )
        return [{"seat_number": p.seat_number, "name": p.name} for p in passengers]


class SharedTicketSerializer(serializers.ModelSerializer):
    """
    The ticket behind a shared link, for whoever holds it: what they need to travel, and nothing
    else — no phone numbers, e-mails, prices or payment details.
    """

    status = serializers.CharField(read_only=True)
    status_label = serializers.SerializerMethodField()
    is_valid = serializers.BooleanField(read_only=True)
    qr_code = serializers.SerializerMethodField()
    booking_reference = serializers.CharField(source="booking.booking_reference", read_only=True)
    trip = serializers.SerializerMethodField()
    boarding = serializers.SerializerMethodField()
    dropoff = serializers.SerializerMethodField()
    passengers = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "ticket_number",
            "status",
            "status_label",
            "is_valid",
            "issued_at",
            "qr_code",
            "booking_reference",
            "trip",
            "boarding",
            "dropoff",
            "passengers",
        ]
        read_only_fields = fields

    def get_status_label(self, ticket: Ticket) -> str:
        return TicketStatus(ticket.status).label

    def get_qr_code(self, ticket: Ticket) -> str:
        return qr_data_uri(ticket_code(ticket.ticket_number))

    def get_trip(self, ticket: Ticket) -> dict:
        trip = ticket.booking.trip
        return {
            "code": trip.code,
            "status": trip.status,
            "route_name": trip.route.name,
            "operator_name": trip.operator.company_name,
            "bus_name": trip.bus.name,
            "bus_registration": trip.bus.registration_number,
            "bus_type_label": trip.bus.get_bus_type_display(),
            "departure_datetime": serializers.DateTimeField().to_representation(
                trip.departure_datetime
            ),
        }

    @staticmethod
    def _point(stop, time) -> dict | None:
        if stop is None:
            return None
        return {
            "name": stop.name,
            "city": stop.city,
            "latitude": str(stop.latitude) if stop.latitude is not None else None,
            "longitude": str(stop.longitude) if stop.longitude is not None else None,
            "time": serializers.DateTimeField().to_representation(time) if time else None,
        }

    def get_boarding(self, ticket: Ticket) -> dict | None:
        booking = ticket.booking
        return self._point(
            booking.boarding_stop or booking.trip.route.origin,
            booking.boarding_time or booking.trip.departure_datetime,
        )

    def get_dropoff(self, ticket: Ticket) -> dict | None:
        booking = ticket.booking
        return self._point(
            booking.dropoff_stop or booking.trip.route.destination,
            booking.dropoff_time or booking.trip.estimated_arrival_datetime,
        )

    def get_passengers(self, ticket: Ticket) -> list[dict]:
        passengers = sorted(
            ticket.booking.passengers.all(), key=lambda p: seat_sort_key(p.seat_number)
        )
        return [{"seat_number": p.seat_number, "name": p.name} for p in passengers]


class FindTicketSerializer(serializers.Serializer):
    reference = serializers.CharField(
        max_length=32, error_messages={"blank": "Enter your booking reference."}
    )
    phone = serializers.CharField(
        max_length=32, error_messages={"blank": "Enter the phone number used for the booking."}
    )

    def validate_reference(self, value: str) -> str:
        return "".join(value.split()).upper()

    def validate_phone(self, value: str) -> str:
        try:
            return normalize_phone_number(value)
        except DjangoValidationError:
            raise serializers.ValidationError(
                "Enter a valid phone number, e.g. 077 123 4567."
            ) from None
