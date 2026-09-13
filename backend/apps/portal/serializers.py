"""
What an operator sees of their own trips and bookings.

Enough to run the buses — who is travelling, on which seat, how to reach them, what they paid —
and nothing that belongs to the platform: no customer e-mails, gateway references or ticket links.
"""

from rest_framework import serializers

from apps.bookings.models import Booking, Passenger
from apps.bookings.services import seat_sort_key
from apps.trips.models import Trip, TripStatus


def _when(value):
    return serializers.DateTimeField().to_representation(value) if value else None


class OperatorTripListSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    route_name = serializers.CharField(source="route.name", read_only=True)
    origin = serializers.CharField(source="route.origin.city", read_only=True)
    destination = serializers.CharField(source="route.destination.city", read_only=True)
    arrival_datetime = serializers.DateTimeField(
        source="estimated_arrival_datetime", read_only=True
    )
    bus_registration = serializers.CharField(source="bus.registration_number", read_only=True)
    bus_name = serializers.CharField(source="bus.name", read_only=True)
    seats_sold = serializers.IntegerField(read_only=True)
    capacity = serializers.IntegerField(read_only=True)
    boarded = serializers.IntegerField(read_only=True)
    occupancy = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = [
            "id",
            "code",
            "status",
            "status_label",
            "route_name",
            "origin",
            "destination",
            "departure_datetime",
            "arrival_datetime",
            "bus_registration",
            "bus_name",
            "seats_sold",
            "capacity",
            "occupancy",
            "boarded",
        ]
        read_only_fields = fields

    def get_occupancy(self, trip: Trip) -> float:
        return round(trip.seats_sold / trip.capacity * 100, 1) if trip.capacity else 0.0


class OperatorTripSerializer(OperatorTripListSerializer):
    stops = serializers.SerializerMethodField()
    cancellation_reason = serializers.CharField(read_only=True)
    base_price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta(OperatorTripListSerializer.Meta):
        fields = [
            *OperatorTripListSerializer.Meta.fields,
            "base_price",
            "cancellation_reason",
            "stops",
        ]
        read_only_fields = fields

    def get_stops(self, trip: Trip) -> list[dict]:
        return [
            {
                "sequence": stop.sequence,
                "name": stop.stop.name,
                "city": stop.stop.city,
                "arrival_datetime": _when(stop.arrival_datetime),
                "departure_datetime": _when(stop.departure_datetime),
                "is_boarding_point": stop.is_boarding_point,
                "is_dropoff_point": stop.is_dropoff_point,
            }
            for stop in trip.trip_stops.all()
        ]


class OperatorBookingListSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    booking_reference = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    customer = serializers.SerializerMethodField()
    route_name = serializers.CharField(source="trip.route.name", read_only=True)
    trip = serializers.UUIDField(source="trip_id", read_only=True)
    trip_code = serializers.CharField(source="trip.code", read_only=True)
    departure = serializers.DateTimeField(read_only=True)
    seats = serializers.IntegerField(read_only=True)
    total_amount = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    paid_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    currency = serializers.CharField(read_only=True)
    payment_status = serializers.CharField(read_only=True, default="")
    created_at = serializers.DateTimeField(read_only=True)

    def get_customer(self, booking: Booking) -> dict:
        return {"name": booking.customer.name, "phone": booking.customer.phone}


class OperatorPassengerSerializer(serializers.ModelSerializer):
    boarding_status = serializers.CharField(read_only=True)

    class Meta:
        model = Passenger
        fields = ["id", "seat_number", "name", "phone", "boarding_status", "boarded_at"]
        read_only_fields = fields


class OperatorBookingSerializer(OperatorBookingListSerializer):
    confirmed_at = serializers.DateTimeField(read_only=True)
    cancelled_at = serializers.DateTimeField(read_only=True)
    cancellation_reason = serializers.CharField(read_only=True)
    trip_details = serializers.SerializerMethodField()
    boarding = serializers.SerializerMethodField()
    dropoff = serializers.SerializerMethodField()
    passengers = serializers.SerializerMethodField()
    ticket = serializers.SerializerMethodField()
    refunds = serializers.SerializerMethodField()

    def get_trip_details(self, booking: Booking) -> dict:
        trip = booking.trip
        return {
            "id": str(trip.pk),
            "code": trip.code,
            "status": trip.status,
            "status_label": TripStatus(trip.status).label,
            "route_name": trip.route.name,
            "departure_datetime": _when(trip.departure_datetime),
            "bus_registration": trip.bus.registration_number,
        }

    @staticmethod
    def _point(stop, time) -> dict | None:
        return None if stop is None else {"name": stop.name, "time": _when(time)}

    def get_boarding(self, booking: Booking) -> dict | None:
        return self._point(booking.boarding_stop, booking.boarding_time)

    def get_dropoff(self, booking: Booking) -> dict | None:
        return self._point(booking.dropoff_stop, booking.dropoff_time)

    def get_passengers(self, booking: Booking) -> list[dict]:
        passengers = sorted(booking.passengers.all(), key=lambda p: seat_sort_key(p.seat_number))
        return OperatorPassengerSerializer(passengers, many=True).data

    def get_ticket(self, booking: Booking) -> dict | None:
        ticket = getattr(booking, "ticket", None)
        if ticket is None:
            return None
        return {"ticket_number": ticket.ticket_number, "status": ticket.status}

    def get_refunds(self, booking: Booking) -> list[dict]:
        return [
            {
                "amount": f"{refund.amount:.2f}",
                "status": refund.status,
                "status_label": refund.get_status_display(),
                "created_at": _when(refund.created_at),
            }
            for refund in booking.refunds.all()
        ]
