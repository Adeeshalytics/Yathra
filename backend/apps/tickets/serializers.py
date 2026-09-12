from rest_framework import serializers

from apps.bookings.serializers import BookingSerializer
from apps.bookings.services import seat_sort_key
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
