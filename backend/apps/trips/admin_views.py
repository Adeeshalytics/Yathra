from django.db import transaction
from django.db.models import Count, Max, Prefetch, Q
from django.db.models.functions import Now
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from apps.audit.models import ActivityAction
from apps.audit.services import log_activity
from apps.bookings.admin_views import manifest_counts, manifest_rows
from apps.core.admin_viewsets import ActivationActionsMixin, AdminModelViewSet
from apps.core.renderers import FileRenderer
from apps.core.reporting import export_response
from apps.reports.views import as_json_row

from .admin_serializers import (
    AdminTripListSerializer,
    AdminTripScheduleSerializer,
    AdminTripSerializer,
    CancelTripSerializer,
    GenerateTripsSerializer,
    TripStatusSerializer,
)
from .filters import TripFilter
from .models import (
    OPEN_TRIP_STATUSES,
    Trip,
    TripSchedule,
    TripStatus,
    TripStop,
)
from .selectors import with_availability
from .services import (
    assignment_errors,
    cancel_trip,
    change_status,
    describe_conflict,
    find_bus_conflict,
    generate_trips,
    replace_trip_stops,
    route_timetable,
    timings_from_route,
)

MANIFEST_COLUMNS = [
    ("seat_number", "Seat"),
    ("name", "Passenger"),
    ("phone", "Phone"),
    ("boarding_point", "Boarding"),
    ("dropoff_point", "Drop-off"),
    ("booking_reference", "Booking"),
    ("booking_status", "Status"),
    ("boarding_state", "Boarded"),
]


def manifest_heading(trip: Trip) -> dict:
    """The block at the top of the manifest: which bus is going where, and when."""
    departure = timezone.localtime(trip.departure_datetime)
    return {
        "id": str(trip.pk),
        "code": trip.code,
        "route_name": trip.route.name,
        "origin": trip.route.origin.city,
        "destination": trip.route.destination.city,
        "departure_datetime": trip.departure_datetime,
        "departure_date": departure.strftime("%d %b %Y"),
        "departure_time": departure.strftime("%I:%M %p").lstrip("0"),
        "bus_registration": trip.bus.registration_number,
        "bus_name": trip.bus.name,
        "operator_name": trip.operator.company_name,
        "status": trip.status,
    }


class AdminTripManifestMixin:
    """The crew's passenger list for one trip, on screen or on paper."""

    @extend_schema(summary="Passenger manifest for a trip", responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def manifest(self, request, *args, **kwargs):
        trip = self.get_object()
        rows = [as_json_row(dict(row)) for row in manifest_rows(trip)]
        return Response(
            {
                "trip": manifest_heading(trip),
                "counts": manifest_counts(trip),
                "columns": [{"key": key, "header": header} for key, header in MANIFEST_COLUMNS],
                "passengers": rows,
                "printed_at": timezone.now(),
            }
        )

    @extend_schema(
        summary="Passenger manifest as a PDF",
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    @action(
        detail=True,
        methods=["get"],
        url_path="manifest/pdf",
        renderer_classes=[FileRenderer, JSONRenderer],
    )
    def manifest_pdf(self, request, *args, **kwargs):
        trip = self.get_object()
        heading = manifest_heading(trip)
        counts = manifest_counts(trip)
        return export_response(
            "pdf",
            filename=f"yathra-manifest-{trip.code}",
            title=f"Passenger manifest · {heading['route_name']}",
            subtitle=(
                f"{heading['origin']} → {heading['destination']} · {heading['departure_date']} · "
                f"{heading['departure_time']} · Bus {heading['bus_registration']} · "
                f"Trip {heading['code']}"
            ),
            columns=MANIFEST_COLUMNS,
            rows=manifest_rows(trip).iterator(chunk_size=200),
            summary=[
                ("Passengers", f"{counts['passengers']} / {counts['capacity']}"),
                ("Boarded", str(counts["boarded"])),
                ("Occupancy", f"{counts['occupancy']}%"),
            ],
        )


class AdminTripViewSet(AdminTripManifestMixin, ActivationActionsMixin, AdminModelViewSet):
    """Scheduled journeys. Cancel instead of delete once a trip has bookings."""

    filterset_class = TripFilter
    search_fields = ["code", "route__name", "bus__registration_number", "operator__company_name"]
    ordering_fields = ["departure_datetime", "base_price", "created_at"]
    ordering = ["departure_datetime"]

    def get_queryset(self):
        queryset = with_availability(
            Trip.objects.select_related(
                "route__origin", "route__destination", "bus__seat_layout", "operator"
            )
        )
        if self.action != "list":
            queryset = queryset.prefetch_related(
                Prefetch(
                    "trip_stops",
                    queryset=TripStop.objects.select_related("stop").order_by("sequence"),
                )
            )
        return queryset

    def get_serializer_class(self):
        return AdminTripListSerializer if self.action == "list" else AdminTripSerializer

    def set_record_active(self, trip: Trip, active: bool) -> None:
        if active and trip.status in (TripStatus.CANCELLED, TripStatus.COMPLETED):
            raise ValidationError(
                {"active": ["Cancelled or completed trips can’t be put back on sale."]}
            )
        super().set_record_active(trip, active)

    def get_delete_blocker(self, trip: Trip) -> str | None:
        bookings = trip.bookings.count()
        if bookings:
            return f"{trip.code} has {bookings} booking(s). Cancel the trip instead of deleting it."
        return None

    @extend_schema(request=CancelTripSerializer, summary="Cancel a trip (can't be undone)")
    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        trip = self.get_object()
        serializer = CancelTripSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"].strip()
        with transaction.atomic():
            cancel_trip(trip, reason)
            log_activity(
                actor=request.user,
                action=ActivityAction.CANCELLED,
                instance=trip,
                changes={"reason": reason} if reason else {},
            )
        return Response(self.get_serializer(self.reload(trip)).data)

    @extend_schema(request=TripStatusSerializer, summary="Move a trip to its next status")
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, *args, **kwargs):
        trip = self.get_object()
        serializer = TripStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        previous = trip.status
        with transaction.atomic():
            change_status(trip, serializer.validated_data["status"])
            log_activity(
                actor=request.user,
                action=ActivityAction.STATUS_CHANGED,
                instance=trip,
                changes={"from": previous, "to": trip.status},
            )
        return Response(self.get_serializer(self.reload(trip)).data)

    @extend_schema(request=None, summary="Rebuild stop times from the route's timetable")
    @action(detail=True, methods=["post"], url_path="reset-timings")
    def reset_timings(self, request, *args, **kwargs):
        trip = self.get_object()
        if not trip.is_editable:
            raise ValidationError(
                {"non_field_errors": ["Only scheduled trips can change their times."]}
            )
        timings = timings_from_route(route_timetable(trip.route), trip.departure_datetime)
        arrival = timings[-1]["arrival_datetime"]
        conflict = find_bus_conflict(trip.bus, trip.departure_datetime, arrival, exclude_pk=trip.pk)
        if conflict:
            raise ValidationError({"bus": [describe_conflict(conflict)]})
        with transaction.atomic():
            trip.estimated_arrival_datetime = arrival
            trip.save(update_fields=["estimated_arrival_datetime", "updated_at"])
            replace_trip_stops(trip, timings)
            log_activity(
                actor=request.user,
                action=ActivityAction.UPDATED,
                instance=trip,
                changes={"fields": ["stops"]},
            )
        return Response(self.get_serializer(self.reload(trip)).data)


class AdminTripScheduleViewSet(ActivationActionsMixin, AdminModelViewSet):
    """Recurring timetables. Deleting one keeps the trips it generated."""

    serializer_class = AdminTripScheduleSerializer
    filterset_fields = ["route", "bus", "operator", "recurrence", "active"]
    search_fields = ["route__name", "bus__registration_number", "operator__company_name"]
    ordering_fields = ["departure_time", "start_date", "created_at"]
    ordering = ["route__name", "departure_time"]

    def get_queryset(self):
        return TripSchedule.objects.select_related(
            "route__origin", "route__destination", "bus__seat_layout", "operator"
        ).annotate(
            trip_count=Count("trips", distinct=True),
            upcoming_trip_count=Count(
                "trips",
                filter=Q(trips__departure_datetime__gt=Now(), trips__status__in=OPEN_TRIP_STATUSES),
                distinct=True,
            ),
            journey_duration=Max("route__route_stops__arrival_offset"),
        )

    @extend_schema(request=GenerateTripsSerializer, summary="Generate (or preview) trips")
    @action(detail=True, methods=["post"])
    def generate(self, request, *args, **kwargs):
        schedule = self.get_object()
        serializer = GenerateTripsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not schedule.active:
            raise ValidationError(
                {"non_field_errors": ["Activate this schedule before generating trips from it."]}
            )
        errors = assignment_errors(route=schedule.route, bus=schedule.bus)
        if errors:
            raise ValidationError(errors)

        data = serializer.validated_data
        result = generate_trips(
            schedule, data["from_date"], data["to_date"], dry_run=data["dry_run"]
        )
        if result["created"]:
            log_activity(
                actor=request.user,
                action=ActivityAction.GENERATED,
                instance=schedule,
                changes={
                    "created": result["created"],
                    "from_date": data["from_date"].isoformat(),
                    "to_date": data["to_date"].isoformat(),
                },
            )
        return Response(result)
