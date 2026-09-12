import logging

from django.conf import settings
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from apps.bookings.models import Booking
from apps.bookings.views import IsCustomerOrAdmin, is_admin
from apps.core.admin_viewsets import UUID_LOOKUP_REGEX
from apps.core.exceptions import error_payload

from . import services
from .models import OPEN_PAYMENT_STATUSES, Payment, PaymentMethod, Refund
from .providers import (
    InvalidNotification,
    checkout_providers,
    default_provider_code,
    provider_for,
)
from .providers.mock import MockProvider
from .serializers import PaymentSerializer, RefundSerializer, StartPaymentSerializer

logger = logging.getLogger("apps.payments")


class PaymentVerifyThrottle(UserRateThrottle):
    """Status checks call the gateway's API: keep them to a sensible rate per account."""

    scope = "payment_verify"

    def get_rate(self):
        return getattr(settings, "PAYMENT_VERIFY_THROTTLE_RATE", "20/min")


class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    Payment attempts. Customers start and follow payments for their own bookings; the booking is
    confirmed by the gateway's verified notification, never by these endpoints.
    """

    permission_classes = [IsCustomerOrAdmin]
    serializer_class = PaymentSerializer
    lookup_value_regex = UUID_LOOKUP_REGEX
    filterset_fields = ["booking", "status"]
    ordering = ["-created_at"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Payment.objects.none()
        queryset = Payment.objects.select_related("booking")
        user = self.request.user
        return queryset if is_admin(user) else queryset.filter(booking__customer=user)

    def _own(self, payment: Payment) -> Payment:
        if payment.booking.customer_id != self.request.user.pk:
            raise PermissionDenied("Only the customer who made this booking can do this.")
        return payment

    def _reload(self, payment: Payment) -> Response:
        return Response(self.get_serializer(self.get_queryset().get(pk=payment.pk)).data)

    def get_throttles(self):
        throttles = super().get_throttles()
        return [*throttles, PaymentVerifyThrottle()] if self.action == "verify" else throttles

    @extend_schema(summary="Payment methods customers can choose", responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"])
    def providers(self, request, *args, **kwargs):
        return Response(
            {
                "default": default_provider_code(),
                "providers": [provider.describe() for provider in checkout_providers()],
            }
        )

    @extend_schema(
        summary="Pay Now: start a payment and get the gateway checkout",
        request=StartPaymentSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    def create(self, request, *args, **kwargs):
        body = StartPaymentSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        booking = get_object_or_404(
            Booking.objects.filter(customer=request.user), pk=body.validated_data["booking"]
        )
        payment, checkout = services.start_payment(
            booking, provider_code=body.validated_data["provider"]
        )
        if payment is None:  # nothing to pay: confirmed straight away
            return Response(
                {"payment": None, "checkout": {"method": "none", "url": "", "fields": {}}},
                status=status.HTTP_201_CREATED,
            )
        return Response(
            {
                "payment": self.get_serializer(self.get_queryset().get(pk=payment.pk)).data,
                "checkout": checkout.as_dict(),
            },
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(summary="Ask the gateway for this payment's status now", request=None)
    @action(detail=True, methods=["post"])
    def verify(self, request, *args, **kwargs):
        payment = self.get_object()
        if not is_admin(request.user):
            self._own(payment)
        services.reconcile(payment)
        return self._reload(payment)

    @extend_schema(summary="The customer cancelled on the gateway's page", request=None)
    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        payment = self._own(self.get_object())
        services.cancel_attempt(payment)
        return self._reload(payment)


class RefundViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Money on its way back. Customers see their own refunds; admins see every one."""

    permission_classes = [IsCustomerOrAdmin]
    serializer_class = RefundSerializer
    lookup_value_regex = UUID_LOOKUP_REGEX
    filterset_fields = ["status", "booking"]
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "amount"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Refund.objects.none()
        queryset = Refund.objects.select_related("booking")
        user = self.request.user
        return queryset if is_admin(user) else queryset.filter(booking__customer=user)


# ---------------------------------------------------------------------------
# Gateway notifications (server to server; authenticated by the gateway's signature)
# ---------------------------------------------------------------------------
@csrf_exempt
@require_POST
def payment_webhook(request, provider: str, **kwargs):
    body = request.body  # read first: signatures are over the raw bytes
    try:
        outcome = services.process_notification(
            provider, body=body, headers=request.headers, data=request.POST
        )
    except Http404:
        return JsonResponse(error_payload("not_found", "Unknown payment provider."), status=404)
    except InvalidNotification as exc:
        logger.warning("Rejected %s notification: %s", provider, exc)
        return JsonResponse(
            error_payload("invalid_notification", "The notification could not be verified."),
            status=400,
        )
    # 200 even for duplicates, so the gateway stops retrying.
    return JsonResponse({"received": True, "outcome": outcome})


# ---------------------------------------------------------------------------
# The built-in test gateway's hosted checkout page
# ---------------------------------------------------------------------------
MOCK_METHODS = [
    (PaymentMethod.CARD, "Card"),
    (PaymentMethod.MOBILE_WALLET, "Mobile wallet"),
    (PaymentMethod.BANK_TRANSFER, "Online banking"),
]
MOCK_OUTCOMES = {"pay", "pay_later", "decline", "cancel"}


def _deliver(provider: MockProvider, state: dict) -> None:
    """Send the test gateway's notification through the real webhook handler."""
    body, headers = provider.notification(state)
    try:
        services.process_notification(provider.code, body=body, headers=headers, data={})
    except Exception:  # a real gateway would retry; the status check picks it up meanwhile
        logger.exception("Test gateway notification for %s failed", state.get("order_id"))


@require_http_methods(["GET", "POST"])
def mock_checkout(request, **kwargs):
    provider = provider_for(MockProvider.code)
    if provider is None:
        raise Http404("The test gateway is switched off.")
    session = MockProvider.open_session(request.GET.get("session", ""))
    payment = (
        Payment.objects.select_related(
            "booking__trip__route", "booking__boarding_stop", "booking__dropoff_stop"
        )
        .filter(provider=provider.code, transaction_reference=session["ref"])
        .first()
        if session
        else None
    )
    if payment is None:
        return render(
            request,
            "payments/mock_checkout.html",
            {"error": "This payment link has expired or isn’t valid."},
            status=400,
        )

    if request.method == "POST":
        outcome = request.POST.get("outcome")
        method = request.POST.get("method", PaymentMethod.CARD)
        if outcome not in MOCK_OUTCOMES or method not in dict(MOCK_METHODS):
            return render(
                request,
                "payments/mock_checkout.html",
                {"error": "Choose one of the test outcomes."},
                status=400,
            )
        if payment.status in OPEN_PAYMENT_STATUSES:
            if outcome == "pay":
                _deliver(provider, provider.record(payment, status="succeeded", method=method))
            elif outcome == "pay_later":  # paid, but the notification is "lost"
                provider.record(payment, status="succeeded", method=method)
            elif outcome == "decline":
                state = provider.record(
                    payment,
                    status="failed",
                    method=method,
                    message="Your bank declined the payment (test).",
                )
                _deliver(provider, state)
            else:
                provider.record(payment, status="cancelled", message="Cancelled on the test page.")
                return redirect(session["cancel"])
        return redirect(session["return"])

    return render(
        request,
        "payments/mock_checkout.html",
        {
            "payment": payment,
            "booking": payment.booking,
            "is_open": payment.status in OPEN_PAYMENT_STATUSES,
            "methods": MOCK_METHODS,
            "return_url": session["return"],
            "cancel_url": session["cancel"],
            "app_name": settings.APP_NAME,
        },
    )
