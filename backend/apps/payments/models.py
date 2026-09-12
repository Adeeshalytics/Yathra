"""
Payments. A booking can have several payment attempts (a declined card, then a success); the
attempt's status only ever changes on a verified gateway notification, a server-side status
check with the gateway, or an administrator's action — never on the browser's word.

No card number, CVV, PIN or other credential is stored here: customers pay on the gateway's own
hosted page and we keep only the gateway's reference and a whitelisted summary of its reply.
"""

import secrets

from django.conf import settings
from django.db import models
from django.db.models import F, Q

from apps.bookings.models import Booking
from apps.core.models import BaseModel

ONE_OPEN_PAYMENT_CONSTRAINT = "payments_one_open_per_booking"
EVENT_UNIQUE_CONSTRAINT = "payments_event_unique"


def generate_transaction_reference() -> str:
    """Our own idempotency / reconciliation key, sent to the payment gateway as the order id."""
    return f"TXN{secrets.token_hex(10).upper()}"


class PaymentStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PROCESSING = "processing", "Processing"
    SUCCESSFUL = "successful", "Successful"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"
    REFUNDED = "refunded", "Refunded"
    PARTIALLY_REFUNDED = "partially_refunded", "Partially refunded"


# Waiting for the gateway: at most one of these per booking.
OPEN_PAYMENT_STATUSES = (PaymentStatus.PENDING, PaymentStatus.PROCESSING)
# The attempt ended without money changing hands.
UNPAID_PAYMENT_STATUSES = (PaymentStatus.FAILED, PaymentStatus.CANCELLED)
# The gateway took the money (some of it may have been given back since).
CAPTURED_PAYMENT_STATUSES = (
    PaymentStatus.SUCCESSFUL,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
)
# Money we still hold and could refund.
REFUNDABLE_PAYMENT_STATUSES = (PaymentStatus.SUCCESSFUL, PaymentStatus.PARTIALLY_REFUNDED)


class PaymentMethod(models.TextChoices):
    CARD = "card", "Card"
    BANK_TRANSFER = "bank_transfer", "Online banking"
    MOBILE_WALLET = "mobile_wallet", "Mobile wallet"
    CASH = "cash", "Cash"


class Payment(BaseModel):
    """One attempt to pay for a booking through one provider."""

    booking = models.ForeignKey(Booking, on_delete=models.PROTECT, related_name="payments")
    transaction_reference = models.CharField(
        max_length=64, default=generate_transaction_reference, editable=False
    )
    # Code of the gateway in apps.payments.providers ("payhere", "mock") or "manual".
    provider = models.CharField(max_length=32)
    # The gateway's own id for the payment (e.g. PayHere's payment_id), once it reports one.
    provider_reference = models.CharField(max_length=128, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default=settings.DEFAULT_CURRENCY)
    status = models.CharField(
        max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    # Reported by the gateway once paid; blank until then.
    payment_method = models.CharField(max_length=16, choices=PaymentMethod.choices, blank=True)
    refunded_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    failure_reason = models.CharField(max_length=255, blank=True)
    requires_refund = models.BooleanField(
        default=False,
        help_text="Money was taken but the booking couldn't stand (seats gone, trip cancelled, "
        "paid twice…). Refund it.",
    )
    # A whitelisted summary of the gateway's latest reply. Never card or account details.
    provider_data = models.JSONField(default=dict, blank=True)
    expires_at = models.DateTimeField(
        null=True, blank=True, help_text="When the booking's seat hold for this attempt ends."
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["booking", "status"], name="payments_booking_status_idx"),
            models.Index(fields=["status", "created_at"], name="payments_status_created_idx"),
            models.Index(fields=["status", "expires_at"], name="payments_status_expiry_idx"),
            # The revenue and payment reports: captured payments within a date range.
            models.Index(fields=["status", "paid_at"], name="payments_status_paid_idx"),
            models.Index(
                fields=["created_at"],
                condition=Q(requires_refund=True),
                name="payments_needs_refund_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["transaction_reference"], name="payments_transaction_reference_unique"
            ),
            models.UniqueConstraint(
                fields=["provider", "provider_reference"],
                condition=~Q(provider_reference=""),
                name="payments_provider_reference_unique",
            ),
            # A second concurrent attempt could charge the customer twice.
            models.UniqueConstraint(
                fields=["booking"],
                condition=Q(status__in=OPEN_PAYMENT_STATUSES),
                name=ONE_OPEN_PAYMENT_CONSTRAINT,
            ),
            models.CheckConstraint(condition=Q(amount__gt=0), name="payments_amount_positive"),
            models.CheckConstraint(condition=~Q(provider=""), name="payments_provider_set"),
            models.CheckConstraint(
                condition=Q(status__in=PaymentStatus.values), name="payments_status_valid"
            ),
            models.CheckConstraint(
                condition=Q(payment_method__in=[*PaymentMethod.values, ""]),
                name="payments_method_valid",
            ),
            models.CheckConstraint(
                condition=~Q(status__in=CAPTURED_PAYMENT_STATUSES) | Q(paid_at__isnull=False),
                name="payments_captured_has_paid_at",
            ),
            models.CheckConstraint(
                condition=Q(refunded_amount__gte=0, refunded_amount__lte=F("amount")),
                name="payments_refund_within_amount",
            ),
        ]

    def __str__(self) -> str:
        return self.transaction_reference

    @property
    def refundable_amount(self):
        if self.status not in REFUNDABLE_PAYMENT_STATUSES:
            return 0
        return self.amount - self.refunded_amount


class EventSource(models.TextChoices):
    WEBHOOK = "webhook", "Gateway notification"
    RECONCILE = "reconcile", "Status check"
    CHECKOUT = "checkout", "Checkout started"
    CUSTOMER = "customer", "Customer"
    ADMIN = "admin", "Administrator"
    SYSTEM = "system", "System"


class EventOutcome(models.TextChoices):
    APPLIED = "applied", "Applied"
    IGNORED = "ignored", "Ignored (already handled)"
    REJECTED = "rejected", "Rejected"


class PaymentEvent(models.Model):
    """
    Everything that happened to a payment, in order: gateway notifications, status checks,
    refunds. (provider, event_id) is unique, so a notification the gateway sends twice — a retry
    or a duplicate — is recognised and never processed a second time.
    """

    id = models.BigAutoField(primary_key=True)
    payment = models.ForeignKey(
        Payment, on_delete=models.CASCADE, related_name="events", null=True, blank=True
    )
    provider = models.CharField(max_length=32)
    event_id = models.CharField(max_length=160)
    source = models.CharField(max_length=16, choices=EventSource.choices)
    status = models.CharField(max_length=20, blank=True, help_text="Status the event reported.")
    outcome = models.CharField(max_length=16, choices=EventOutcome.choices)
    message = models.CharField(max_length=255, blank=True)
    # Whitelisted fields only (no card or account details).
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["payment", "created_at"], name="payments_event_recent_idx")]
        constraints = [
            models.UniqueConstraint(fields=["provider", "event_id"], name=EVENT_UNIQUE_CONSTRAINT),
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.event_id} ({self.outcome})"


ONE_OPEN_REFUND_CONSTRAINT = "payments_one_open_refund_per_payment"


def generate_refund_reference() -> str:
    """Customer-facing refund reference, e.g. ``RF7K2M9XHA``."""
    return f"RF{secrets.token_hex(5).upper()}"


class RefundStatus(models.TextChoices):
    REQUESTED = "requested", "Requested"
    PROCESSING = "processing", "Processing"
    COMPLETED = "completed", "Completed"
    REJECTED = "rejected", "Rejected"


OPEN_REFUND_STATUSES = (RefundStatus.REQUESTED, RefundStatus.PROCESSING)
RESOLVED_REFUND_STATUSES = (RefundStatus.COMPLETED, RefundStatus.REJECTED)


class Refund(BaseModel):
    """
    Money owed back to a customer: raised when a booking is cancelled under the refund policy,
    or when a payment couldn't be used (paid twice, seats gone). It is the team's work queue —
    `requested` → `processing` → `completed` or `rejected` — and completing one actually moves
    the money through the payment's gateway.
    """

    booking = models.ForeignKey(Booking, on_delete=models.PROTECT, related_name="refunds")
    payment = models.ForeignKey(
        Payment, on_delete=models.PROTECT, related_name="refunds", null=True, blank=True
    )
    reference = models.CharField(max_length=32, default=generate_refund_reference, editable=False)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default=settings.DEFAULT_CURRENCY)
    status = models.CharField(
        max_length=16, choices=RefundStatus.choices, default=RefundStatus.REQUESTED
    )
    reason = models.CharField(max_length=255, blank=True, help_text="Why the refund was asked for.")
    resolution = models.CharField(max_length=255, blank=True, help_text="What the team decided.")
    # The policy numbers at the time of the request, so a later policy change can't rewrite it.
    breakdown = models.JSONField(default=dict, blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refund_requests",
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refunds_resolved",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"], name="payments_refund_status_idx"),
            models.Index(fields=["booking", "-created_at"], name="payments_refund_booking_idx"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["reference"], name="payments_refund_reference_unique"),
            models.CheckConstraint(
                condition=Q(amount__gt=0), name="payments_refund_amount_positive"
            ),
            models.CheckConstraint(
                condition=Q(status__in=RefundStatus.values), name="payments_refund_status_valid"
            ),
            # One live request per payment, so the same money is never refunded twice.
            models.UniqueConstraint(
                fields=["payment"],
                condition=Q(status__in=OPEN_REFUND_STATUSES),
                name=ONE_OPEN_REFUND_CONSTRAINT,
            ),
            models.CheckConstraint(
                condition=~Q(status__in=RESOLVED_REFUND_STATUSES) | Q(resolved_at__isnull=False),
                name="payments_refund_resolved_has_time",
            ),
        ]

    def __str__(self) -> str:
        return self.reference

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_REFUND_STATUSES
