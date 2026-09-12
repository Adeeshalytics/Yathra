from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from apps.accounts.models import UserRole
from apps.accounts.permissions import HasRole, IsAdmin
from apps.core.admin_viewsets import UUID_LOOKUP_REGEX
from apps.core.renderers import PDFRenderer
from apps.tickets.models import Ticket
from apps.tickets.pdf import render_ticket_pdf
from apps.tickets.serializers import TicketSerializer, paying_payment
from apps.trips.models import Trip

from . import cancellation, services
from .filters import BookingFilter
from .models import Booking, SeatLock
from .selectors import dashboard_summary, with_departure
from .serializers import (
    BookingCreateSerializer,
    BookingSerializer,
    CancelBookingSerializer,
    ConfirmPaymentSerializer,
    HoldQuerySerializer,
    PassengerUpdateSerializer,
    SeatLockRequestSerializer,
    SeatReleaseSerializer,
)


def is_admin(user) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN


class IsCustomerOrAdmin(HasRole):
    """Customers book for themselves; admins see and manage every booking."""

    allowed_roles = (UserRole.CUSTOMER, UserRole.ADMIN)


class SeatLockThrottle(UserRateThrottle):
    """Caps how fast one account can grab seats (default 60 lock requests a minute)."""

    scope = "seat_lock"

    def get_rate(self):
        return getattr(settings, "SEAT_LOCK_THROTTLE_RATE", "60/min")


class SeatLockViewSet(viewsets.GenericViewSet):
    """
    The signed-in customer's temporary seat holds. All their locks on one trip share a single
    countdown; every response describes that hold (seats, expiry, server-side price).
    """

    permission_classes = [IsCustomerOrAdmin]
    serializer_class = SeatLockRequestSerializer
    lookup_value_regex = UUID_LOOKUP_REGEX
    filter_backends = []
    pagination_class = None

    def get_throttles(self):
        throttles = super().get_throttles()
        return [*throttles, SeatLockThrottle()] if self.action == "create" else throttles

    def get_queryset(self):
        return SeatLock.objects.filter(customer=self.request.user)

    @staticmethod
    def _trip(trip_id) -> Trip:
        return get_object_or_404(Trip.objects.select_related("bus"), pk=trip_id)

    def _hold(self, trip_id, status_code=status.HTTP_200_OK) -> Response:
        return Response(
            services.hold_summary(self._trip(trip_id), self.request.user), status=status_code
        )

    @extend_schema(
        summary="Your current hold on a trip",
        parameters=[OpenApiParameter("trip", OpenApiTypes.UUID, required=True)],
        responses=OpenApiTypes.OBJECT,
    )
    def list(self, request, *args, **kwargs):
        query = HoldQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        return self._hold(query.validated_data["trip"])

    @extend_schema(
        summary="Lock seats (all or none) for the default 5 minutes",
        request=SeatLockRequestSerializer,
        responses={201: OpenApiTypes.OBJECT, 409: OpenApiTypes.OBJECT},
    )
    def create(self, request, *args, **kwargs):
        body = SeatLockRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        services.lock_seats(
            trip_id=body.validated_data["trip"],
            customer=request.user,
            seat_numbers=body.validated_data["seats"],
        )
        return self._hold(body.validated_data["trip"], status.HTTP_201_CREATED)

    @extend_schema(summary="Release one locked seat", responses=OpenApiTypes.OBJECT)
    def destroy(self, request, *args, **kwargs):
        lock = get_object_or_404(self.get_queryset(), pk=kwargs["pk"])
        services.release_locks(
            trip_id=lock.trip_id, customer=request.user, seat_numbers=[lock.seat_number]
        )
        return self._hold(lock.trip_id)

    @extend_schema(
        summary="Release several (or all) of your locked seats on a trip",
        request=SeatReleaseSerializer,
        responses=OpenApiTypes.OBJECT,
    )
    @action(detail=False, methods=["post"])
    def release(self, request, *args, **kwargs):
        body = SeatReleaseSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        services.release_locks(
            trip_id=body.validated_data["trip"],
            customer=request.user,
            seat_numbers=body.validated_data.get("seats"),
        )
        return self._hold(body.validated_data["trip"])


class BookingViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    Bookings. Customers see and change only their own (others answer 404); admins see all and
    can record payments and cancel paid bookings.
    """

    permission_classes = [IsCustomerOrAdmin]
    serializer_class = BookingSerializer
    lookup_value_regex = UUID_LOOKUP_REGEX
    filterset_class = BookingFilter
    search_fields = ["booking_reference", "trip__route__name", "passengers__name"]
    ordering_fields = ["created_at", "departure", "total_amount"]
    ordering = ["-created_at"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    # Each dashboard tab reads best in its own order: the next trip first, history newest first.
    ORDERING_BY_SCOPE = {
        "upcoming": ["departure"],
        "past": ["-departure"],
        "cancelled": ["-created_at"],
    }

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # OpenAPI schema generation
            return Booking.objects.none()
        queryset = with_departure(
            Booking.objects.select_related(
                "customer",
                "trip__route__origin",
                "trip__route__destination",
                "trip__operator",
                "trip__bus",
                "boarding_stop",
                "dropoff_stop",
                "ticket",
            ).prefetch_related("passengers", "payments", "refunds")
        )
        user = self.request.user
        # A customer only ever sees their own bookings; anything else answers 404.
        return queryset if is_admin(user) else queryset.filter(customer=user)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        scope = request.query_params.get("scope", "")
        self.ordering = self.ORDERING_BY_SCOPE.get(scope, BookingViewSet.ordering)
        # Present holds that ran out as expired straight away (the sweep command also does it).
        if request.method == "GET":
            services.release_expired_holds(
                customer=None if is_admin(request.user) else request.user
            )

    def _reload(self, booking: Booking) -> Response:
        return Response(self.get_serializer(self.get_queryset().get(pk=booking.pk)).data)

    def _own(self, booking: Booking) -> Booking:
        if booking.customer_id != self.request.user.pk:
            raise PermissionDenied("Only the customer who made this booking can change it.")
        return booking

    @extend_schema(
        summary="Book your locked seats",
        request=BookingCreateSerializer,
        responses={201: BookingSerializer},
    )
    def create(self, request, *args, **kwargs):
        body = BookingCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        booking = services.create_booking(
            customer=request.user,
            trip_id=data["trip"],
            boarding_stop_id=data["boarding_stop"],
            dropoff_stop_id=data["dropoff_stop"],
            passengers=data["passengers"],
        )
        response = self._reload(booking)
        response.status_code = status.HTTP_201_CREATED
        return response

    @extend_schema(summary="Correct passenger details", request=PassengerUpdateSerializer)
    def partial_update(self, request, *args, **kwargs):
        booking = self._own(self.get_object())
        body = PassengerUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        services.update_passengers(booking, body.validated_data["passengers"])
        return self._reload(booking)

    @extend_schema(summary="Confirm the review and wait for payment", request=None)
    @action(detail=True, methods=["post"])
    def checkout(self, request, *args, **kwargs):
        booking = self._own(self.get_object())
        services.submit_for_payment(booking)
        return self._reload(booking)

    @extend_schema(
        summary="Counts and totals for the account dashboard", responses=OpenApiTypes.OBJECT
    )
    @action(detail=False, methods=["get"])
    def summary(self, request, *args, **kwargs):
        return Response(dashboard_summary(self.get_queryset()))

    @extend_schema(
        summary="Can this booking be cancelled, and what comes back?",
        responses=OpenApiTypes.OBJECT,
    )
    @action(detail=True, methods=["get"])
    def cancellation(self, request, *args, **kwargs):
        booking = self.get_object()
        decision = cancellation.quote(booking, staff=is_admin(request.user))
        return Response(decision.as_dict())

    @extend_schema(summary="Cancel a booking", request=CancelBookingSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        booking = self.get_object()
        if not is_admin(request.user):
            self._own(booking)
        body = CancelBookingSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        services.cancel_booking(
            booking,
            reason=body.validated_data["reason"],
            allow_paid=is_admin(request.user),
            actor=request.user,
        )
        return self._reload(booking)

    @extend_schema(
        summary="Record a successful payment (admin) — confirms the booking",
        request=ConfirmPaymentSerializer,
    )
    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def confirm(self, request, *args, **kwargs):
        booking = self.get_object()
        body = ConfirmPaymentSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        services.confirm_payment(booking, method=body.validated_data["payment_method"])
        return self._reload(booking)

    @staticmethod
    def _ticket(booking: Booking) -> Ticket:
        try:
            return booking.ticket
        except ObjectDoesNotExist:
            raise NotFound(
                "Your e-ticket is issued as soon as your payment is confirmed.",
                code="ticket_not_issued",
            ) from None

    @extend_schema(summary="The booking's e-ticket (with its QR code)", responses=TicketSerializer)
    @action(detail=True, methods=["get"])
    def ticket(self, request, *args, **kwargs):
        return Response(TicketSerializer(self._ticket(self.get_object())).data)

    @extend_schema(
        summary="Download the e-ticket as a PDF",
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    @action(
        detail=True,
        methods=["get"],
        url_path="ticket/pdf",
        renderer_classes=[JSONRenderer, PDFRenderer],
    )
    def ticket_pdf(self, request, *args, **kwargs):
        ticket = self._ticket(self.get_object())
        pdf = render_ticket_pdf(ticket, payment=paying_payment(ticket.booking))
        response = HttpResponse(pdf, content_type="application/pdf")
        filename = f"{settings.APP_NAME.lower()}-ticket-{ticket.booking.booking_reference}.pdf"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "private, no-store"
        return response
