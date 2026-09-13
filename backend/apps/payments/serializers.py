from decimal import Decimal

from rest_framework import serializers

from .models import Payment, PaymentEvent, Refund, RefundStatus
from .providers import provider_for, provider_label


class StartPaymentSerializer(serializers.Serializer):
    booking = serializers.UUIDField()
    provider = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")


class RefundPaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
        required=False,
        allow_null=True,
        help_text="Leave out to refund everything not yet refunded.",
    )
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    external = serializers.BooleanField(
        default=False,
        help_text="The money was already returned outside the gateway API (its portal, cash).",
    )


class PaymentSerializer(serializers.ModelSerializer):
    """What a customer may see about their own payment attempts."""

    booking = serializers.UUIDField(source="booking_id", read_only=True)
    booking_reference = serializers.CharField(source="booking.booking_reference", read_only=True)
    booking_status = serializers.CharField(source="booking.status", read_only=True)
    provider_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    payment_method_label = serializers.CharField(
        source="get_payment_method_display", read_only=True
    )

    class Meta:
        model = Payment
        fields = [
            "id",
            "transaction_reference",
            "booking",
            "booking_reference",
            "booking_status",
            "provider",
            "provider_name",
            "status",
            "status_label",
            "payment_method",
            "payment_method_label",
            "amount",
            "currency",
            "refunded_amount",
            "requires_refund",
            "failure_reason",
            "created_at",
            "paid_at",
            "refunded_at",
        ]
        read_only_fields = fields

    def get_provider_name(self, payment: Payment) -> str:
        return provider_label(payment.provider)


class RefundSerializer(serializers.ModelSerializer):
    """What a customer may see about money coming back to them."""

    booking = serializers.UUIDField(source="booking_id", read_only=True)
    booking_reference = serializers.CharField(source="booking.booking_reference", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Refund
        fields = [
            "id",
            "reference",
            "booking",
            "booking_reference",
            "amount",
            "currency",
            "status",
            "status_label",
            "reason",
            "resolution",
            "created_at",
            "resolved_at",
        ]
        read_only_fields = fields


class RefundStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=RefundStatus.choices)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    external = serializers.BooleanField(
        default=False,
        help_text="Completing only: the money was returned outside the gateway API.",
    )


class PaymentEventSerializer(serializers.ModelSerializer):
    source_label = serializers.CharField(source="get_source_display", read_only=True)
    outcome_label = serializers.CharField(source="get_outcome_display", read_only=True)

    class Meta:
        model = PaymentEvent
        fields = [
            "id",
            "source",
            "source_label",
            "event_id",
            "status",
            "outcome",
            "outcome_label",
            "message",
            "data",
            "created_at",
        ]
        read_only_fields = fields


class AdminPaymentSerializer(PaymentSerializer):
    customer = serializers.SerializerMethodField()
    trip = serializers.SerializerMethodField()
    refundable_amount = serializers.SerializerMethodField()
    refund_through_gateway = serializers.SerializerMethodField()

    class Meta(PaymentSerializer.Meta):
        fields = [
            *PaymentSerializer.Meta.fields,
            "provider_reference",
            "customer",
            "trip",
            "refundable_amount",
            "refund_through_gateway",
            "expires_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_customer(self, payment: Payment) -> dict:
        customer = payment.booking.customer
        return {
            "id": str(customer.pk),
            "name": customer.name,
            "email": customer.email,
            "phone": customer.phone,
        }

    def get_trip(self, payment: Payment) -> dict:
        trip = payment.booking.trip
        return {
            "id": str(trip.pk),
            "code": trip.code,
            "route": trip.route.name,
            "departure_datetime": serializers.DateTimeField().to_representation(
                trip.departure_datetime
            ),
        }

    def get_refundable_amount(self, payment: Payment) -> str:
        return f"{payment.refundable_amount:.2f}"

    def get_refund_through_gateway(self, payment: Payment) -> bool:
        provider = provider_for(payment.provider)
        return bool(provider and provider.supports_refunds)


class AdminPaymentDetailSerializer(AdminPaymentSerializer):
    events = PaymentEventSerializer(many=True, read_only=True)
    booking_detail = serializers.SerializerMethodField()

    class Meta(AdminPaymentSerializer.Meta):
        fields = [
            *AdminPaymentSerializer.Meta.fields,
            "provider_data",
            "booking_detail",
            "events",
        ]
        read_only_fields = fields

    def get_booking_detail(self, payment: Payment) -> dict:
        booking = payment.booking
        return {
            "id": str(booking.pk),
            "booking_reference": booking.booking_reference,
            "status": booking.status,
            "status_label": booking.get_status_display(),
            "total_amount": f"{booking.total_amount:.2f}",
            "currency": booking.currency,
            "seats": sorted(p.seat_number for p in booking.passengers.all()),
        }


class AdminRefundSerializer(RefundSerializer):
    """The refund queue as the support team sees it."""

    customer = serializers.SerializerMethodField()
    trip = serializers.SerializerMethodField()
    payment = serializers.SerializerMethodField()
    requested_by = serializers.EmailField(source="requested_by.email", default="", read_only=True)
    resolved_by = serializers.EmailField(source="resolved_by.email", default="", read_only=True)

    class Meta(RefundSerializer.Meta):
        fields = [
            *RefundSerializer.Meta.fields,
            "customer",
            "trip",
            "payment",
            "breakdown",
            "requested_by",
            "resolved_by",
            "updated_at",
        ]
        read_only_fields = fields

    def get_customer(self, refund: Refund) -> dict:
        customer = refund.booking.customer
        return {
            "id": str(customer.pk),
            "name": customer.name,
            "email": customer.email,
            "phone": customer.phone,
        }

    def get_trip(self, refund: Refund) -> dict:
        trip = refund.booking.trip
        return {
            "id": str(trip.pk),
            "code": trip.code,
            "route": trip.route.name,
            "departure_datetime": serializers.DateTimeField().to_representation(
                trip.departure_datetime
            ),
        }

    def get_payment(self, refund: Refund) -> dict | None:
        payment = refund.payment
        if payment is None:
            return None
        return {
            "id": str(payment.pk),
            "transaction_reference": payment.transaction_reference,
            "provider": payment.provider,
            "provider_name": provider_label(payment.provider),
            "status": payment.status,
            "refundable_amount": f"{payment.refundable_amount:.2f}",
            "refund_through_gateway": bool(
                (provider := provider_for(payment.provider)) and provider.supports_refunds
            ),
        }
