from rest_framework import serializers

from .models import Trip


class TripSummarySerializer(serializers.ModelSerializer):
    """Compact trip description embedded in bookings."""

    route_name = serializers.CharField(source="route.name", read_only=True)
    origin = serializers.CharField(source="route.origin.name", read_only=True)
    destination = serializers.CharField(source="route.destination.name", read_only=True)
    bus_name = serializers.CharField(source="bus.name", read_only=True)
    bus_type = serializers.CharField(source="bus.bus_type", read_only=True)
    operator_name = serializers.CharField(source="operator.company_name", read_only=True)

    class Meta:
        model = Trip
        fields = [
            "id",
            "departure_datetime",
            "status",
            "base_price",
            "route_name",
            "origin",
            "destination",
            "bus_name",
            "bus_type",
            "operator_name",
        ]
        read_only_fields = fields
