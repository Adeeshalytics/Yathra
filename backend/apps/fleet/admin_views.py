from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.admin_viewsets import ActivationActionsMixin, AdminModelViewSet

from .admin_serializers import (
    AdminBusSerializer,
    SeatLayoutGenerateSerializer,
    SeatLayoutListSerializer,
    SeatLayoutSerializer,
)
from .filters import BusFilter
from .models import BOOKABLE_SEAT_TYPES, PASSENGER_SEAT_TYPES, Bus, SeatLayout
from .seat_layouts import generate_layout


class AdminBusViewSet(ActivationActionsMixin, AdminModelViewSet):
    serializer_class = AdminBusSerializer
    filterset_class = BusFilter
    search_fields = ["registration_number", "name", "operator__company_name"]
    ordering_fields = ["name", "registration_number", "seat_capacity", "created_at"]
    ordering = ["name"]

    def get_queryset(self):
        return Bus.objects.select_related("operator", "seat_layout").annotate(
            trip_count=Count("trips")
        )

    def get_delete_blocker(self, bus: Bus) -> str | None:
        trips = bus.trips.count()
        schedules = bus.schedules.count()
        if trips or schedules:
            return (
                f"{bus.registration_number} has {trips} trip(s) and {schedules} schedule(s) on "
                "record. Deactivate the bus instead of deleting it."
            )
        return None


class AdminSeatLayoutViewSet(ActivationActionsMixin, AdminModelViewSet):
    filterset_fields = ["layout_type", "active"]
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at"]
    ordering = ["name"]

    def get_queryset(self):
        queryset = SeatLayout.objects.annotate(
            seat_count=Count(
                "seats", filter=Q(seats__seat_type__in=PASSENGER_SEAT_TYPES), distinct=True
            ),
            bookable_seat_count=Count(
                "seats",
                filter=Q(seats__seat_type__in=BOOKABLE_SEAT_TYPES, seats__is_available=True),
                distinct=True,
            ),
            bus_count=Count("buses", distinct=True),
        )
        if self.action != "list":
            queryset = queryset.prefetch_related("seats")
        return queryset

    def get_serializer_class(self):
        if self.action == "generate":
            return SeatLayoutGenerateSerializer
        if self.action == "list":
            return SeatLayoutListSerializer
        return SeatLayoutSerializer

    def get_delete_blocker(self, layout: SeatLayout) -> str | None:
        buses = layout.buses.count()
        if buses:
            return (
                f"{buses} bus(es) use the “{layout.name}” layout. "
                "Assign them a different layout first."
            )
        return None

    @extend_schema(
        request=SeatLayoutGenerateSerializer,
        summary="Generate a standard 2+2 / 2+1 layout (not saved)",
    )
    @action(detail=False, methods=["post"])
    def generate(self, request, *args, **kwargs):
        serializer = SeatLayoutGenerateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(generate_layout(**serializer.validated_data))
