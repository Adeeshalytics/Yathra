"""
The operator portal API: a bus company's own trips, bookings, manifests and takings.

Every queryset starts from `request.operator` (set by IsActiveOperatorMember), so another
company's records are never loaded: they are simply not found. Owners and managers also see the
money; staff — conductors, counter clerks — see the trips and the people on them.

    GET /api/v1/operator/dashboard/
    GET /api/v1/operator/trips/                     ?when=upcoming|past, status, route, dates
    GET /api/v1/operator/trips/{id}/                (+ manifest/, manifest/pdf/)
    GET /api/v1/operator/bookings/                  ?status, trip, dates, search
    GET /api/v1/operator/bookings/{id}/
    GET /api/v1/operator/reports/{revenue|routes}/  (+ export/) — owners and managers
"""

from datetime import datetime, time, timedelta

import django_filters
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, F, OuterRef, Prefetch, Q, QuerySet, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.bookings.models import PAID_STATUSES, Booking, BookingStatus, Passenger
from apps.core.admin_viewsets import UUID_LOOKUP_REGEX
from apps.core.reporting import DateRange, parse_date_range
from apps.core.validators import normalize_phone_number
from apps.operators.permissions import MANAGER_ROLES, IsActiveOperatorMember, IsOperatorManager
from apps.reports import services as reports
from apps.reports.views import ReportDetailView, ReportExportView
from apps.trips.admin_views import AdminTripManifestMixin
from apps.trips.models import OPEN_TRIP_STATUSES, Trip, TripStatus, TripStop

from .serializers import (
    OperatorBookingListSerializer,
    OperatorBookingSerializer,
    OperatorTripListSerializer,
    OperatorTripSerializer,
)

NEXT_TRIPS_LIMIT = 6
OPERATOR_REPORTS = ("revenue", "routes")


def can_see_money(request) -> bool:
    return request.operator_membership.role in MANAGER_ROLES


def _count_passengers(**conditions) -> Coalesce:
    counted = (
        Passenger.objects.filter(trip=OuterRef("pk"), holds_seat=True, **conditions)
        .order_by()
        .values("trip")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return Coalesce(Subquery(counted), Value(0))


def trips_with_counts(operator) -> QuerySet[Trip]:
    return (
        Trip.objects.filter(operator=operator)
        .select_related("route__origin", "route__destination", "bus")
        .annotate(
            seats_sold=_count_passengers(),
            boarded=_count_passengers(boarded_at__isnull=False),
            capacity=F("bus__seat_capacity"),
        )
    )


def _start_of_today() -> datetime:
    return timezone.make_aware(datetime.combine(timezone.localdate(), time.min))


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
class OperatorDashboardView(APIView):
    """Today at a glance, what leaves next, and — for owners and managers — the takings."""

    permission_classes = [IsActiveOperatorMember]

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Operator dashboard")
    def get(self, request, *args, **kwargs):
        operator = request.operator
        now = timezone.now()
        today = parse_date_range({"range": "today"})

        todays_trips = today.filter(Trip.objects.filter(operator=operator), "departure_datetime")
        running = todays_trips.exclude(status=TripStatus.CANCELLED)
        trips = todays_trips.aggregate(
            total=Count("id"),
            cancelled=Count("id", filter=Q(status=TripStatus.CANCELLED)),
            capacity=Coalesce(
                Sum("bus__seat_capacity", filter=~Q(status=TripStatus.CANCELLED)), Value(0)
            ),
        )
        travelling = Passenger.objects.filter(trip__in=running.values("pk"), holds_seat=True)
        people = travelling.aggregate(
            passengers=Count("id"), boarded=Count("id", filter=Q(boarded_at__isnull=False))
        )
        sold_today = today.filter(
            Booking.objects.filter(trip__operator=operator, status__in=PAID_STATUSES),
            "confirmed_at",
        ).aggregate(bookings=Count("id", distinct=True), seats=Count("passengers"))

        upcoming = trips_with_counts(operator).filter(
            status__in=OPEN_TRIP_STATUSES, departure_datetime__gt=now
        )
        next_trips = OperatorTripListSerializer(
            upcoming.order_by("departure_datetime")[:NEXT_TRIPS_LIMIT], many=True
        ).data

        body = {
            "operator": {
                "id": str(operator.pk),
                "company_name": operator.company_name,
                "status": operator.status,
            },
            "role": request.operator_membership.role,
            "can_see_revenue": can_see_money(request),
            "today": {
                "date": today.from_date.isoformat(),
                "trips": trips["total"],
                "cancelled_trips": trips["cancelled"],
                "capacity": trips["capacity"],
                "passengers": people["passengers"],
                "boarded": people["boarded"],
                "occupancy": (
                    round(people["passengers"] / trips["capacity"] * 100, 1)
                    if trips["capacity"]
                    else 0.0
                ),
                "bookings_sold": sold_today["bookings"],
                "seats_sold": sold_today["seats"],
            },
            "upcoming": {
                "next_7_days": upcoming.filter(
                    departure_datetime__lte=now + timedelta(days=7)
                ).count(),
                "trips": next_trips,
            },
            "revenue": None,
        }
        if can_see_money(request):
            scope = {"operator": str(operator.pk)}
            body["revenue"] = {
                "today": reports.revenue_report(today, scope).summary,
                "month": reports.revenue_report(
                    parse_date_range({"range": "month"}), scope
                ).summary,
            }
        return Response(body)


# ---------------------------------------------------------------------------
# Trips
# ---------------------------------------------------------------------------
class OperatorTripFilter(django_filters.FilterSet):
    when = django_filters.ChoiceFilter(
        choices=[("upcoming", "Today and later"), ("past", "Before today")], method="filter_when"
    )
    status = django_filters.MultipleChoiceFilter(choices=TripStatus.choices)
    route = django_filters.UUIDFilter(field_name="route_id")
    bus = django_filters.UUIDFilter(field_name="bus_id")
    date = django_filters.DateFilter(field_name="departure_datetime", lookup_expr="date")
    date_from = django_filters.DateFilter(field_name="departure_datetime", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="departure_datetime", lookup_expr="date__lte")

    class Meta:
        model = Trip
        fields = ["when", "status", "route", "bus", "date", "date_from", "date_to"]

    def filter_when(self, queryset, name, value):
        start = _start_of_today()
        if value == "past":
            return queryset.filter(departure_datetime__lt=start)
        return queryset.filter(departure_datetime__gte=start)


class OperatorTripViewSet(AdminTripManifestMixin, viewsets.ReadOnlyModelViewSet):
    """The company's trips, each with seats sold and who has boarded, and its manifest."""

    permission_classes = [IsActiveOperatorMember]
    lookup_value_regex = UUID_LOOKUP_REGEX
    filterset_class = OperatorTripFilter
    search_fields = ["code", "route__name", "bus__registration_number"]
    ordering_fields = ["departure_datetime"]
    ordering = ["departure_datetime"]

    def get_queryset(self) -> QuerySet[Trip]:
        queryset = trips_with_counts(self.request.operator).select_related("operator")
        if self.action == "list":
            return queryset
        return queryset.prefetch_related(
            Prefetch("trip_stops", queryset=TripStop.objects.select_related("stop"))
        )

    def get_serializer_class(self):
        return OperatorTripListSerializer if self.action == "list" else OperatorTripSerializer

    def retrieve(self, request, *args, **kwargs):
        trip = self.get_object()
        body = OperatorTripSerializer(trip).data
        bookings = Booking.objects.filter(trip=trip).aggregate(
            confirmed=Count("id", filter=Q(status__in=PAID_STATUSES)),
            awaiting_payment=Count(
                "id", filter=Q(status__in=(BookingStatus.PENDING, BookingStatus.PAYMENT_PENDING))
            ),
            cancelled=Count("id", filter=Q(status=BookingStatus.CANCELLED)),
        )
        body["bookings"] = bookings
        body["revenue"] = (
            reports.revenue_report(
                DateRange("all", "All time", None, None), {"trip": trip.pk}
            ).summary
            if can_see_money(request)
            else None
        )
        return Response(body)


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------
class OperatorBookingFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=BookingStatus.choices)
    trip = django_filters.UUIDFilter(field_name="trip_id")
    route = django_filters.UUIDFilter(field_name="trip__route_id")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    departure_from = django_filters.DateFilter(field_name="departure", lookup_expr="date__gte")
    departure_to = django_filters.DateFilter(field_name="departure", lookup_expr="date__lte")

    class Meta:
        model = Booking
        fields = [
            "status",
            "trip",
            "route",
            "date_from",
            "date_to",
            "departure_from",
            "departure_to",
        ]


class PhoneAwareSearchFilter(SearchFilter):
    """Phones are stored as +94…; whoever searches types 077 123 4567. Both should match."""

    def get_search_terms(self, request):
        raw = request.query_params.get(self.search_param, "")
        compact = raw.replace(" ", "").replace("-", "")
        if compact.lstrip("+").isdigit() and len(compact) >= 9:
            try:
                return [normalize_phone_number(compact)]
            except DjangoValidationError:
                pass
        return super().get_search_terms(request)


class OperatorBookingViewSet(viewsets.ReadOnlyModelViewSet):
    """Every booking on the company's trips (read-only: cancelling stays with support)."""

    permission_classes = [IsActiveOperatorMember]
    lookup_value_regex = UUID_LOOKUP_REGEX
    filter_backends = [DjangoFilterBackend, PhoneAwareSearchFilter, OrderingFilter]
    filterset_class = OperatorBookingFilter
    search_fields = [
        "booking_reference",
        "customer__name",
        "customer__phone",
        "passengers__name",
        "passengers__phone",
        "trip__code",
    ]
    ordering_fields = ["created_at", "departure", "total_amount"]
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet[Booking]:
        queryset = (
            Booking.objects.filter(trip__operator=self.request.operator)
            .annotate(
                departure=reports.booking_departure(),
                seats=reports.seats_in_booking(),
                paid_amount=reports.paid_for_booking(),
                payment_status=reports.latest_payment_status(),
            )
            .select_related("customer", "trip__route", "trip__bus")
        )
        if self.action == "list":
            return queryset.distinct()  # searching passengers can multiply rows
        return queryset.select_related("boarding_stop", "dropoff_stop", "ticket").prefetch_related(
            "passengers", "refunds"
        )

    def get_serializer_class(self):
        return OperatorBookingListSerializer if self.action == "list" else OperatorBookingSerializer


# ---------------------------------------------------------------------------
# Revenue
# ---------------------------------------------------------------------------
class _OperatorReport:
    """The admin reports, limited to two and to the operator's own trips — whatever is asked."""

    permission_classes = [IsOperatorManager]
    allowed_reports = OPERATOR_REPORTS

    def report_params(self, request):
        params = {key: request.query_params.get(key) for key in ("route", "bus", "trip")}
        return {**params, "operator": str(request.operator.pk)}


class OperatorReportView(_OperatorReport, ReportDetailView):
    @extend_schema(
        operation_id="operator_reports_run",
        responses=OpenApiTypes.OBJECT,
        summary="Run the revenue or route report for your company",
    )
    def get(self, request, key: str, *args, **kwargs):
        return super().get(request, key, *args, **kwargs)


class OperatorReportExportView(_OperatorReport, ReportExportView):
    @extend_schema(
        operation_id="operator_reports_export",
        responses={(200, "text/csv"): OpenApiTypes.BINARY},
        summary="Download the revenue or route report for your company",
    )
    def get(self, request, key: str, *args, **kwargs):
        return super().get(request, key, *args, **kwargs)
