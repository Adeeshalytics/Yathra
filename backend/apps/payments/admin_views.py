import django_filters
from django.db import transaction
from django.db.models import Prefetch
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.audit.models import ActivityAction
from apps.audit.services import log_activity
from apps.core.admin_viewsets import UUID_LOOKUP_REGEX

from . import services
from .models import Payment, PaymentEvent, PaymentStatus, Refund, RefundStatus
from .serializers import (
    AdminPaymentDetailSerializer,
    AdminPaymentSerializer,
    AdminRefundSerializer,
    RefundPaymentSerializer,
    RefundStatusSerializer,
)


class PaymentFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=PaymentStatus.choices)
    provider = django_filters.CharFilter()
    requires_refund = django_filters.BooleanFilter()
    booking = django_filters.UUIDFilter(field_name="booking_id")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = Payment
        fields = ["status", "provider", "requires_refund", "booking", "date_from", "date_to"]


class RefundFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=RefundStatus.choices)
    booking = django_filters.UUIDFilter(field_name="booking_id")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = Refund
        fields = ["status", "booking", "date_from", "date_to"]


class AdminRefundViewSet(viewsets.ReadOnlyModelViewSet):
    """The refund queue: what the platform owes customers, and how far along each one is."""

    permission_classes = [IsAdmin]
    lookup_value_regex = UUID_LOOKUP_REGEX
    serializer_class = AdminRefundSerializer
    filterset_class = RefundFilter
    search_fields = [
        "reference",
        "booking__booking_reference",
        "booking__customer__email",
        "booking__customer__name",
    ]
    ordering_fields = ["created_at", "amount", "resolved_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return Refund.objects.select_related(
            "booking__customer", "booking__trip__route", "payment", "requested_by", "resolved_by"
        )

    @extend_schema(
        summary="Move a refund along: processing, completed or rejected",
        request=RefundStatusSerializer,
    )
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, *args, **kwargs):
        refund = self.get_object()
        body = RefundStatusSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        with transaction.atomic():
            updated = services.set_refund_status(
                refund,
                status=data["status"],
                note=data["note"],
                actor=request.user,
                external=data["external"],
            )
            log_activity(
                actor=request.user,
                action=ActivityAction.REFUNDED,
                instance=updated,
                changes={
                    "status": updated.status,
                    "amount": f"{updated.amount:.2f}",
                    "reason": data["note"],
                },
            )
        return Response(self.get_serializer(self.get_queryset().get(pk=updated.pk)).data)


class AdminPaymentViewSet(viewsets.ReadOnlyModelViewSet):
    """Every payment attempt, with refunds and on-demand status checks with the gateway."""

    permission_classes = [IsAdmin]
    lookup_value_regex = UUID_LOOKUP_REGEX
    filterset_class = PaymentFilter
    search_fields = [
        "transaction_reference",
        "provider_reference",
        "booking__booking_reference",
        "booking__customer__email",
        "booking__customer__name",
    ]
    ordering_fields = ["created_at", "amount", "paid_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        queryset = Payment.objects.select_related("booking__customer", "booking__trip__route")
        if self.action != "list":
            queryset = queryset.prefetch_related(
                "booking__passengers",
                Prefetch("events", queryset=PaymentEvent.objects.order_by("created_at", "id")),
            )
        return queryset

    def get_serializer_class(self):
        return AdminPaymentSerializer if self.action == "list" else AdminPaymentDetailSerializer

    def _detail(self, payment: Payment) -> Response:
        return Response(AdminPaymentDetailSerializer(self.get_queryset().get(pk=payment.pk)).data)

    @extend_schema(summary="Headline payment numbers", responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"])
    def summary(self, request, *args, **kwargs):
        return Response(services.payment_summary())

    @extend_schema(summary="Refund all or part of a payment", request=RefundPaymentSerializer)
    @action(detail=True, methods=["post"])
    def refund(self, request, *args, **kwargs):
        payment = self.get_object()
        body = RefundPaymentSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        with transaction.atomic():
            refunded = services.refund_payment(
                payment, amount=data.get("amount"), reason=data["reason"], external=data["external"]
            )
            log_activity(
                actor=request.user,
                action=ActivityAction.REFUNDED,
                instance=refunded,
                changes={
                    "amount": f"{refunded.refunded_amount:.2f}",
                    "status": refunded.status,
                    "reason": data["reason"],
                },
            )
        return self._detail(payment)

    @extend_schema(summary="Ask the gateway for this payment's status now", request=None)
    @action(detail=True, methods=["post"])
    def reconcile(self, request, *args, **kwargs):
        payment = self.get_object()
        services.reconcile(payment)
        return self._detail(payment)
