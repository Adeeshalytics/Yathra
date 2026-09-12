"""
The admin's view of bookings and passengers.

Both are read-mostly lists over large tables, so every column the screens show is either a
database annotation or a joined field — no per-row queries, and the browser only ever receives
one page at a time.
"""

import django_filters
from django.db import transaction
from django.db.models import Case, CharField, Count, F, Q, QuerySet, Value, When
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.audit.models import ActivityAction
from apps.audit.services import log_activity
from apps.core.admin_viewsets import UUID_LOOKUP_REGEX
from apps.payments.models import PaymentStatus
from apps.reports.services import (
    booking_departure,
    latest_payment_status,
    latest_payment_status_for_passenger,
    paid_for_booking,
    seats_in_booking,
)

from . import cancellation, services
from .models import Booking, BookingStatus, Passenger
from .serializers import BookingSerializer, CancelBookingSerializer


class AdminBookingListSerializer(serializers.Serializer):
    """The booking list: flat, and every field comes straight from the query."""

    id = serializers.UUIDField(read_only=True)
    booking_reference = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    customer = serializers.SerializerMethodField()
    route_name = serializers.CharField(source="trip.route.name", read_only=True)
    trip_code = serializers.CharField(source="trip.code", read_only=True)
    trip = serializers.UUIDField(source="trip_id", read_only=True)
    departure = serializers.DateTimeField(read_only=True)
    seats = serializers.IntegerField(read_only=True)
    total_amount = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    paid_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    currency = serializers.CharField(read_only=True)
    payment_status = serializers.CharField(read_only=True, default="")
    created_at = serializers.DateTimeField(read_only=True)

    def get_customer(self, booking: Booking) -> dict:
        return {
            "id": str(booking.customer_id),
            "name": booking.customer.name,
            "email": booking.customer.email,
        }


class AdminBookingFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=BookingStatus.choices)
    payment_status = django_filters.ChoiceFilter(
        choices=PaymentStatus.choices, field_name="payment_status"
    )
    trip = django_filters.UUIDFilter(field_name="trip_id")
    route = django_filters.UUIDFilter(field_name="trip__route_id")
    operator = django_filters.UUIDFilter(field_name="trip__operator_id")
    bus = django_filters.UUIDFilter(field_name="trip__bus_id")
    customer = django_filters.UUIDFilter(field_name="customer_id")
    # Dates can mean "when it was booked" or "when they travel"; both are useful.
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    departure_from = django_filters.DateFilter(field_name="departure", lookup_expr="date__gte")
    departure_to = django_filters.DateFilter(field_name="departure", lookup_expr="date__lte")

    class Meta:
        model = Booking
        fields = [
            "status",
            "payment_status",
            "trip",
            "route",
            "operator",
            "bus",
            "customer",
            "date_from",
            "date_to",
            "departure_from",
            "departure_to",
        ]


class AdminBookingViewSet(viewsets.ReadOnlyModelViewSet):
    """Every booking on the platform, with the detail and the cancel button support needs."""

    permission_classes = [IsAdmin]
    lookup_value_regex = UUID_LOOKUP_REGEX
    filterset_class = AdminBookingFilter
    search_fields = [
        "booking_reference",
        "customer__name",
        "customer__email",
        "passengers__name",
        "passengers__phone",
        "trip__code",
        "trip__route__name",
    ]
    ordering_fields = ["created_at", "departure", "total_amount"]
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet[Booking]:
        queryset = Booking.objects.annotate(
            departure=booking_departure(),
            seats=seats_in_booking(),
            paid_amount=paid_for_booking(),
            payment_status=latest_payment_status(),
        ).select_related("customer", "trip__route", "trip__bus", "trip__operator")
        if self.action == "list":
            return queryset.distinct()  # searching passengers can multiply rows
        return queryset.select_related(
            "trip__route__origin",
            "trip__route__destination",
            "boarding_stop",
            "dropoff_stop",
            "ticket",
        ).prefetch_related("passengers", "payments", "refunds")

    def get_serializer_class(self):
        return AdminBookingListSerializer if self.action == "list" else BookingSerializer

    @extend_schema(summary="What cancelling this booking would do", responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def cancellation(self, request, *args, **kwargs):
        return Response(cancellation.quote(self.get_object(), staff=True).as_dict())

    @extend_schema(
        summary="Cancel a booking on the customer's behalf", request=CancelBookingSerializer
    )
    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        booking = self.get_object()
        body = CancelBookingSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        with transaction.atomic():
            services.cancel_booking(
                booking,
                reason=body.validated_data["reason"],
                allow_paid=True,
                actor=request.user,
            )
            log_activity(
                actor=request.user,
                action=ActivityAction.CANCELLED,
                instance=booking,
                changes={"reason": body.validated_data["reason"]},
            )
        return Response(BookingSerializer(self.get_queryset().get(pk=booking.pk)).data)


def boarding_state_annotation() -> Case:
    return Case(
        When(boarded_at__isnull=False, then=Value("boarded")),
        When(holds_seat=True, then=Value("expected")),
        default=Value("released"),
        output_field=CharField(),
    )


class AdminPassengerSerializer(serializers.Serializer):
    """One line of the passenger list — the same shape the manifest prints."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    phone = serializers.CharField(read_only=True)
    seat_number = serializers.CharField(read_only=True)
    booking = serializers.UUIDField(source="booking_id", read_only=True)
    booking_reference = serializers.CharField(source="booking.booking_reference", read_only=True)
    booking_status = serializers.CharField(source="booking.status", read_only=True)
    payment_status = serializers.CharField(read_only=True, default="")
    boarding_status = serializers.CharField(read_only=True)
    boarded_at = serializers.DateTimeField(read_only=True)
    boarding_point = serializers.SerializerMethodField()
    dropoff_point = serializers.SerializerMethodField()
    trip = serializers.UUIDField(source="trip_id", read_only=True)
    trip_code = serializers.CharField(source="trip.code", read_only=True)
    route_name = serializers.CharField(source="trip.route.name", read_only=True)
    bus_registration = serializers.CharField(source="trip.bus.registration_number", read_only=True)
    departure = serializers.DateTimeField(read_only=True)

    def get_boarding_point(self, passenger: Passenger) -> str:
        stop = passenger.booking.boarding_stop
        return stop.name if stop else passenger.trip.route.origin.name

    def get_dropoff_point(self, passenger: Passenger) -> str:
        stop = passenger.booking.dropoff_stop
        return stop.name if stop else passenger.trip.route.destination.name


class AdminPassengerFilter(django_filters.FilterSet):
    trip = django_filters.UUIDFilter(field_name="trip_id")
    route = django_filters.UUIDFilter(field_name="trip__route_id")
    bus = django_filters.UUIDFilter(field_name="trip__bus_id")
    operator = django_filters.UUIDFilter(field_name="trip__operator_id")
    booking = django_filters.UUIDFilter(field_name="booking_id")
    boarding_status = django_filters.ChoiceFilter(
        choices=[("boarded", "Boarded"), ("expected", "Expected"), ("released", "Released")],
        field_name="boarding_state",
    )
    date = django_filters.DateFilter(field_name="departure", lookup_expr="date")
    date_from = django_filters.DateFilter(field_name="departure", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="departure", lookup_expr="date__lte")

    class Meta:
        model = Passenger
        fields = ["trip", "route", "bus", "operator", "booking", "boarding_status", "date"]


class AdminPassengerViewSet(viewsets.ReadOnlyModelViewSet):
    """Who is travelling — by trip, route, date, bus or booking — and who has boarded."""

    permission_classes = [IsAdmin]
    lookup_value_regex = UUID_LOOKUP_REGEX
    serializer_class = AdminPassengerSerializer
    filterset_class = AdminPassengerFilter
    search_fields = ["name", "phone", "booking__booking_reference"]
    ordering_fields = ["departure", "seat_number", "name"]
    ordering = ["departure", "seat_number"]

    def get_queryset(self) -> QuerySet[Passenger]:
        return Passenger.objects.annotate(
            payment_status=latest_payment_status_for_passenger(),
            boarding_state=boarding_state_annotation(),
            departure=F("trip__departure_datetime"),
        ).select_related(
            "booking__boarding_stop",
            "booking__dropoff_stop",
            "trip__route__origin",
            "trip__route__destination",
            "trip__bus",
        )

    @extend_schema(
        summary="Check a passenger onto the bus (or undo it)", request=OpenApiTypes.OBJECT
    )
    @action(detail=True, methods=["post"])
    def boarding(self, request, *args, **kwargs):
        passenger = self.get_object()
        boarded = bool(request.data.get("boarded", True))
        passenger.boarded_at = timezone.now() if boarded else None
        passenger.save(update_fields=["boarded_at", "updated_at"])
        return Response(self.get_serializer(self.get_queryset().get(pk=passenger.pk)).data)


def manifest_rows(trip) -> QuerySet:
    """The passengers on one trip, in seat order, for the manifest."""
    return (
        Passenger.objects.filter(trip=trip, holds_seat=True)
        .annotate(
            payment_status=latest_payment_status_for_passenger(),
            boarding_state=boarding_state_annotation(),
        )
        .order_by("seat_number")
        .values(
            "id",
            "name",
            "phone",
            "seat_number",
            "boarded_at",
            "payment_status",
            "boarding_state",
            booking_reference=F("booking__booking_reference"),
            booking_status=F("booking__status"),
            boarding_point=F("booking__boarding_stop__name"),
            dropoff_point=F("booking__dropoff_stop__name"),
        )
    )


def manifest_counts(trip) -> dict:
    counted = Passenger.objects.filter(trip=trip, holds_seat=True).aggregate(
        passengers=Count("id"),
        boarded=Count("id", filter=Q(boarded_at__isnull=False)),
    )
    capacity = trip.bus.seat_capacity
    return {
        "capacity": capacity,
        "passengers": counted["passengers"],
        "boarded": counted["boarded"],
        "empty_seats": max(capacity - counted["passengers"], 0),
        "occupancy": round(counted["passengers"] / capacity * 100, 1) if capacity else 0.0,
    }
