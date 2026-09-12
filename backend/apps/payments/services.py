"""
Payment orchestration — the only code that moves a payment between statuses, whatever the
gateway:

    start_payment         the customer presses Pay Now: a payment attempt + a hosted checkout
    process_notification  the gateway's server-to-server notification (the source of truth)
    reconcile             ask the gateway directly (its notification is late, or never came)
    cancel_attempt        the customer came back through the gateway's cancel link
    refund_payment        an administrator refunds all or part of a payment

A booking is confirmed only from a verified gateway result (a signed notification or a
server-side status look-up) — never because the browser came back to our "success" page.

Idempotency: every gateway result is stored as a PaymentEvent with a unique
(provider, event_id), so a notification that is delivered twice or retried is recognised and
skipped; and a payment's status only moves forward (a late "pending" never undoes "successful"),
so a notification racing a status check can't confirm a booking twice either.

Locks are taken trip → booking → payment, the same order as the booking engine.
"""

import logging
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, DecimalField, ExpressionWrapper, F, Sum
from django.http import Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError

from apps.bookings import services as booking_services
from apps.bookings.models import Booking
from apps.core.db import violated_constraint
from apps.core.exceptions import Conflict
from apps.core.logging import log_event

from . import refunds as refund_requests
from .models import (
    CAPTURED_PAYMENT_STATUSES,
    EVENT_UNIQUE_CONSTRAINT,
    OPEN_PAYMENT_STATUSES,
    OPEN_REFUND_STATUSES,
    REFUNDABLE_PAYMENT_STATUSES,
    RESOLVED_REFUND_STATUSES,
    UNPAID_PAYMENT_STATUSES,
    EventOutcome,
    EventSource,
    Payment,
    PaymentEvent,
    PaymentStatus,
    Refund,
    RefundStatus,
)
from .providers import (
    MANUAL_PROVIDER,
    CheckoutSession,
    GatewayResult,
    PaymentProvider,
    ProviderError,
    RefundNotSupported,
    default_provider_code,
    get_checkout_provider,
    provider_for,
)

logger = logging.getLogger("apps.payments")

FAILURE_MESSAGES = {
    PaymentStatus.FAILED: "The payment was declined.",
    PaymentStatus.CANCELLED: "The payment was cancelled.",
}
# How long after it starts an open attempt is left to its notification before the sweep asks
# the gateway about it.
RECONCILE_AFTER = timedelta(minutes=2)


class GatewayUnavailable(APIException):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "We couldn’t reach the payment gateway. Please try again in a moment."
    default_code = "gateway_unavailable"


class PaymentInProgress(Conflict):
    default_code = "payment_in_progress"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def return_url(payment: Payment) -> str:
    return f"{settings.FRONTEND_URL}/bookings/{payment.booking_id}/payment?payment={payment.pk}"


def cancel_url(payment: Payment) -> str:
    return f"{return_url(payment)}&cancelled=1"


def notify_url(provider_code: str) -> str:
    return f"{settings.PUBLIC_API_URL}/api/v1/payments/webhooks/{provider_code}/"


def _event(
    payment: Payment,
    *,
    source: str,
    message: str = "",
    outcome: str = EventOutcome.APPLIED,
    data: dict | None = None,
) -> PaymentEvent:
    """Record something that happened on our side (the gateway's own events come in apply)."""
    return PaymentEvent.objects.create(
        payment=payment,
        provider=payment.provider,
        event_id=f"{source}:{uuid.uuid4().hex}",
        source=source,
        status=payment.status,
        outcome=outcome,
        message=message[:255],
        data=data or {},
    )


def _close(payment: Payment, new_status: str, reason: str, *, source: str) -> None:
    payment.status = new_status
    payment.failure_reason = reason[:255]
    payment.save(update_fields=["status", "failure_reason", "updated_at"])
    _event(payment, source=source, message=reason)


def _locked(payment_id, booking_id) -> tuple[Booking, Payment]:
    """Lock trip → booking → payment and return fresh copies (inside a transaction)."""
    booking = booking_services.lock_for_payment(booking_id)
    return booking, Payment.objects.select_for_update().get(pk=payment_id)


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------
def start_payment(
    booking: Booking, *, provider_code: str = ""
) -> tuple[Payment | None, CheckoutSession | None]:
    """
    Open (or resume) a payment attempt for the booking and the gateway session to pay it in.
    The booking's seats are held for the payment window. Returns (None, None) when there is
    nothing to pay and the booking was confirmed straight away.
    """
    provider = get_checkout_provider(provider_code or default_provider_code())
    if provider is None:
        raise ValidationError(
            {"provider": ["This payment method isn’t available. Please choose another."]}
        )
    booking_services.sweep_trip(booking.trip_id)
    with transaction.atomic():
        now = timezone.now()
        locked = booking_services.hold_for_payment(booking, now)
        if locked.total_amount <= 0:
            booking_services.settle_payment(locked, now)
            return None, None

        open_attempts = list(
            Payment.objects.select_for_update().filter(
                booking=locked, status__in=OPEN_PAYMENT_STATUSES
            )
        )
        if any(p.status == PaymentStatus.PROCESSING for p in open_attempts):
            raise PaymentInProgress(
                "Your last payment for this booking is still being processed. We’ll update "
                "your booking as soon as the bank confirms it."
            )
        payment = next(
            (
                p
                for p in open_attempts
                if p.provider == provider.code
                and p.amount == locked.total_amount
                and p.currency == locked.currency
            ),
            None,
        )
        for stale in open_attempts:
            if stale is not payment:
                _close(
                    stale,
                    PaymentStatus.CANCELLED,
                    "Replaced by a new payment attempt.",
                    source=EventSource.CUSTOMER,
                )
        if payment is None:
            payment = Payment.objects.create(
                booking=locked,
                provider=provider.code,
                amount=locked.total_amount,
                currency=locked.currency,
                expires_at=locked.expires_at,
            )
            _event(
                payment,
                source=EventSource.CHECKOUT,
                message=f"Checkout started with {provider.name}.",
            )
        else:
            payment.expires_at = locked.expires_at
            payment.save(update_fields=["expires_at", "updated_at"])

    payment.booking = locked
    try:
        checkout = provider.create_checkout(
            payment,
            return_url=return_url(payment),
            cancel_url=cancel_url(payment),
            notify_url=notify_url(provider.code),
        )
    except ProviderError as exc:
        logger.warning("Couldn't start %s checkout for %s: %s", provider.code, payment, exc)
        log_event(
            "payment.checkout_failed",
            level=logging.WARNING,
            payment_id=str(payment.pk),
            booking_reference=locked.booking_reference,
            provider=provider.code,
        )
        raise GatewayUnavailable() from exc
    log_event(
        "payment.started",
        payment_id=str(payment.pk),
        transaction_reference=payment.transaction_reference,
        booking_reference=locked.booking_reference,
        provider=provider.code,
        amount=f"{payment.amount:.2f}",
        currency=payment.currency,
    )
    return payment, checkout


def cancel_attempt(payment: Payment) -> Payment:
    """The customer left the gateway through its cancel link. Only ever cancels: if the gateway
    reports the payment as paid after all, that still counts."""
    with transaction.atomic():
        _, locked = _locked(payment.pk, payment.booking_id)
        if locked.status == PaymentStatus.PENDING:
            _close(
                locked,
                PaymentStatus.CANCELLED,
                "You cancelled the payment.",
                source=EventSource.CUSTOMER,
            )
    return locked


# ---------------------------------------------------------------------------
# Gateway results
# ---------------------------------------------------------------------------
def process_notification(provider_code: str, *, body: bytes, headers, data) -> str:
    """Verify and apply a gateway notification. Raises InvalidNotification if it's forged."""
    provider = provider_for(provider_code)
    if provider is None:
        raise Http404("Unknown payment provider.")
    result = provider.parse_notification(body=body, headers=headers, data=data)
    return apply_result(provider, result, source=EventSource.WEBHOOK)


def apply_result(provider: PaymentProvider, result: GatewayResult, *, source: str) -> str:
    """
    Apply what the gateway says about one of our payments, exactly once. Returns the outcome:
    applied, ignored (nothing new), rejected (e.g. wrong amount), duplicate or unknown_payment.
    """
    event_id = (result.event_id or f"{result.status}:{result.reference}")[:160]
    found = (
        Payment.objects.filter(provider=provider.code, transaction_reference=result.reference)
        .values_list("pk", "booking_id")
        .first()
    )
    if found is None:
        logger.warning("%s reported on unknown payment %r", provider.code, result.reference)
        _record_orphan(provider, event_id, source, result)
        return "unknown_payment"

    with transaction.atomic():
        now = timezone.now()
        booking, payment = _locked(*found)
        try:
            with transaction.atomic():
                event = PaymentEvent.objects.create(
                    payment=payment,
                    provider=provider.code,
                    event_id=event_id,
                    source=source,
                    status=result.status,
                    outcome=EventOutcome.APPLIED,
                    message=result.message[:255],
                    data=result.data,
                )
        except IntegrityError as exc:
            if violated_constraint(exc) != EVENT_UNIQUE_CONSTRAINT:
                raise
            logger.info("Duplicate %s event %s for %s skipped", provider.code, event_id, payment)
            return "duplicate"

        outcome, note = _transition(payment, booking, result, now)
        if outcome != EventOutcome.APPLIED or note:
            event.outcome = outcome
            event.message = (note or event.message)[:255]
            event.save(update_fields=["outcome", "message"])
    return outcome


def _record_orphan(provider, event_id: str, source: str, result: GatewayResult) -> None:
    try:
        with transaction.atomic():
            PaymentEvent.objects.create(
                provider=provider.code,
                event_id=event_id,
                source=source,
                status=result.status,
                outcome=EventOutcome.REJECTED,
                message=f"No payment {result.reference[:64]} here."[:255],
                data=result.data,
            )
    except IntegrityError:
        pass  # the same orphan again


def _absorb(payment: Payment, result: GatewayResult) -> None:
    if result.provider_reference and not payment.provider_reference:
        payment.provider_reference = result.provider_reference[:128]
    if result.data:
        payment.provider_data = {**payment.provider_data, **result.data}


def _ignored(message: str) -> tuple[str, str]:
    return EventOutcome.IGNORED, message


def _transition(payment: Payment, booking: Booking, result: GatewayResult, now) -> tuple[str, str]:
    """Move the payment forward according to the gateway (caller holds the locks)."""
    current, reported = payment.status, result.status

    if reported == PaymentStatus.SUCCESSFUL:
        if current in CAPTURED_PAYMENT_STATUSES:
            return _ignored("Already recorded as paid.")
        return _capture(payment, booking, result, now)

    if reported == PaymentStatus.REFUNDED:  # refunded or charged back at the gateway
        if current not in REFUNDABLE_PAYMENT_STATUSES:
            return _ignored("Nothing left to refund.")
        _absorb(payment, result)
        _record_refund(
            payment,
            booking,
            payment.amount - payment.refunded_amount,
            now,
            reason=result.message or "Refunded at the payment gateway.",
        )
        return EventOutcome.APPLIED, ""

    if reported == PaymentStatus.PROCESSING:
        if current != PaymentStatus.PENDING:
            return _ignored(f"Already {payment.get_status_display().lower()}.")
        _absorb(payment, result)
        payment.status = PaymentStatus.PROCESSING
        payment.save()
        return EventOutcome.APPLIED, ""

    if reported in UNPAID_PAYMENT_STATUSES:
        if current not in OPEN_PAYMENT_STATUSES:
            return _ignored(f"Already {payment.get_status_display().lower()}.")
        _absorb(payment, result)
        payment.status = reported
        payment.failure_reason = (result.message or FAILURE_MESSAGES[reported])[:255]
        payment.save()
        return EventOutcome.APPLIED, ""

    return _ignored("Still waiting for the customer.")


def _capture(payment: Payment, booking: Booking, result: GatewayResult, now) -> tuple[str, str]:
    """The gateway took the money. Confirm the booking if it can still be honoured."""
    _absorb(payment, result)
    currency = (result.currency or payment.currency).upper()
    wrong_amount = result.amount is not None and result.amount != payment.amount
    if wrong_amount or currency != payment.currency:
        reason = (
            f"The gateway reported {currency} {result.amount:,.2f} instead of "
            f"{payment.currency} {payment.amount:,.2f}."
        )
        if payment.status in OPEN_PAYMENT_STATUSES:
            payment.status = PaymentStatus.FAILED
        payment.failure_reason = reason
        payment.requires_refund = True
        payment.save()
        logger.error("Amount mismatch on payment %s: %s", payment, reason)
        log_event(
            "payment.amount_mismatch",
            level=logging.ERROR,
            payment_id=str(payment.pk),
            booking_reference=booking.booking_reference,
            provider=payment.provider,
            expected=f"{payment.amount:.2f}",
            reported=str(result.amount),
        )
        return EventOutcome.REJECTED, reason

    payment.status = PaymentStatus.SUCCESSFUL
    payment.paid_at = now
    payment.payment_method = result.method or payment.payment_method
    payment.failure_reason = ""
    confirmed, reason = booking_services.settle_payment(booking, now)
    if not confirmed:
        payment.requires_refund = True
        payment.failure_reason = reason
        logger.warning("Payment %s needs a refund: %s", payment, reason)
    payment.save()
    log_event(
        "payment.captured",
        payment_id=str(payment.pk),
        transaction_reference=payment.transaction_reference,
        booking_reference=booking.booking_reference,
        provider=payment.provider,
        method=payment.payment_method,
        amount=f"{payment.amount:.2f}",
        currency=payment.currency,
        booking_confirmed=confirmed,
    )
    if not confirmed:
        # The customer paid but has no booking: queue the money to go back.
        refund_requests.request_refund(
            booking,
            amount=payment.amount,
            reason=reason,
            payment=payment,
            breakdown={"source": "payment_could_not_be_used"},
        )
    if confirmed:
        for other in Payment.objects.select_for_update().filter(
            booking=booking, status__in=OPEN_PAYMENT_STATUSES
        ):
            _close(
                other,
                PaymentStatus.CANCELLED,
                "The booking was paid with another payment.",
                source=EventSource.SYSTEM,
            )
    return EventOutcome.APPLIED, reason


def _record_refund(payment: Payment, booking: Booking, amount: Decimal, now, *, reason: str):
    payment.refunded_amount += amount
    payment.refunded_at = now
    fully = payment.refunded_amount >= payment.amount
    payment.status = PaymentStatus.REFUNDED if fully else PaymentStatus.PARTIALLY_REFUNDED
    if fully:
        payment.requires_refund = False
    payment.save()
    still_paid = (
        Payment.objects.filter(booking=booking, status__in=REFUNDABLE_PAYMENT_STATUSES)
        .exclude(pk=payment.pk)
        .exists()
    )
    if fully and not still_paid:
        booking_services.release_refunded(booking, reason, now)


# ---------------------------------------------------------------------------
# Timeouts and status checks
# ---------------------------------------------------------------------------
def reconcile(payment: Payment) -> str:
    """
    Ask the gateway what happened to an attempt — for when its notification is late or lost.
    An open attempt the gateway knows nothing about is given up once it's well past its hold.
    """
    provider = provider_for(payment.provider)
    outcome = "unchanged"
    if provider is not None and payment.provider != MANUAL_PROVIDER:
        try:
            result = provider.fetch_status(payment)
        except ProviderError as exc:
            logger.warning("Status check for %s failed: %s", payment, exc)
            result = None
        if result is not None and result.reference == payment.transaction_reference:
            outcome = apply_result(provider, result, source=EventSource.RECONCILE)
    timed_out = _give_up_if_abandoned(payment)
    return "timed_out" if timed_out else outcome


def _give_up_if_abandoned(payment: Payment) -> bool:
    deadline = (payment.expires_at or payment.created_at) + timedelta(
        minutes=settings.PAYMENT_TIMEOUT_MINUTES
    )
    if timezone.now() < deadline:
        return False
    with transaction.atomic():
        _, locked = _locked(payment.pk, payment.booking_id)
        if locked.status not in OPEN_PAYMENT_STATUSES:
            return False
        _close(
            locked,
            PaymentStatus.CANCELLED,
            "The payment wasn’t completed in time.",
            source=EventSource.SYSTEM,
        )
    return True


def reconcile_open_payments(*, limit: int = 200) -> dict[str, int]:
    """Check every attempt still waiting on its gateway (run by `reconcile_payments`)."""
    outcomes: dict[str, int] = {}
    stale = (
        Payment.objects.filter(
            status__in=OPEN_PAYMENT_STATUSES, created_at__lte=timezone.now() - RECONCILE_AFTER
        )
        .exclude(provider=MANUAL_PROVIDER)
        .order_by("created_at")[:limit]
    )
    for payment in stale:
        outcome = reconcile(payment)
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
    return outcomes


# ---------------------------------------------------------------------------
# Refunds
# ---------------------------------------------------------------------------
def refund_payment(
    payment: Payment, *, amount: Decimal | None = None, reason: str = "", external: bool = False
) -> Payment:
    """
    Refund all (default) or part of a payment. Through the gateway's API when it has one;
    `external` records a refund already made elsewhere (the gateway's portal, cash back).
    A full refund cancels the booking and frees its seats unless another payment covers it.
    """
    provider = provider_for(payment.provider)
    with transaction.atomic():
        now = timezone.now()
        booking, locked = _locked(payment.pk, payment.booking_id)
        if locked.status not in REFUNDABLE_PAYMENT_STATUSES:
            if locked.requires_refund and external:  # e.g. an over/under-payment we rejected
                locked.requires_refund = False
                locked.save(update_fields=["requires_refund", "updated_at"])
                _event(locked, source=EventSource.ADMIN, message=f"Refund made outside: {reason}")
                return locked
            raise Conflict("Only successful payments can be refunded.", code="not_refundable")

        remaining = locked.amount - locked.refunded_amount
        amount = remaining if amount is None else amount
        if amount <= 0 or amount > remaining:
            raise ValidationError({"amount": [f"Enter an amount up to {remaining:,.2f}."]})

        reference = ""
        if external or locked.provider == MANUAL_PROVIDER:
            message = "Refund recorded (made outside the gateway)."
        else:
            if provider is None:
                raise Conflict(
                    "This payment's gateway isn't configured any more. Refund it in the "
                    "gateway's portal, then record it here.",
                    code="refund_not_supported",
                )
            try:
                refund = provider.refund(locked, amount, reason)
            except RefundNotSupported as exc:
                raise Conflict(str(exc), code="refund_not_supported") from exc
            except ProviderError as exc:
                logger.warning("Refund of %s failed: %s", locked, exc)
                raise GatewayUnavailable(str(exc)) from exc
            reference = refund.reference
            message = f"Refunded through {provider.name}."

        _record_refund(locked, booking, amount, now, reason=reason or "Refunded by our team.")
        _event(
            locked,
            source=EventSource.ADMIN,
            message=message,
            data={"amount": f"{amount:.2f}", "reference": reference, "reason": reason[:200]},
        )
    return locked


# ---------------------------------------------------------------------------
# Refund requests
# ---------------------------------------------------------------------------
def set_refund_status(
    refund: Refund,
    *,
    status: str,
    note: str = "",
    actor=None,
    external: bool = False,
) -> Refund:
    """
    Move a refund request along its life cycle. Completing one actually returns the money
    through the payment's gateway (or records a refund made outside it), which is why this
    lives next to `refund_payment`. Locks are taken refund → trip → booking → payment.
    """
    if status not in RefundStatus.values:
        raise ValidationError({"status": ["Unknown refund status."]})
    with transaction.atomic():
        # `of` keeps the lock on the refund row: its payment is nullable, and Postgres refuses
        # to lock the nullable side of an outer join.
        locked = Refund.objects.select_for_update(of=("self",)).get(pk=refund.pk)
        if locked.status == status:
            return locked
        if locked.status in RESOLVED_REFUND_STATUSES:
            raise Conflict(
                f"This refund is already {locked.get_status_display().lower()}.",
                code="refund_resolved",
            )
        if status == RefundStatus.REQUESTED:
            raise Conflict("A refund can't go back to requested.", code="refund_resolved")

        now = timezone.now()
        if status == RefundStatus.COMPLETED and locked.payment_id is not None:
            refund_payment(
                locked.payment,
                amount=locked.amount,
                reason=note or locked.reason or f"Refund {locked.reference}",
                external=external,
            )
        if status in RESOLVED_REFUND_STATUSES and locked.payment_id is not None:
            # The team has settled this request — paid out or turned down — so the payment
            # stops asking to be refunded, unless another request is still open on it. A
            # partial refund under the cancellation policy leaves nothing else owing.
            still_owed = (
                Refund.objects.filter(payment_id=locked.payment_id, status__in=OPEN_REFUND_STATUSES)
                .exclude(pk=locked.pk)
                .exists()
            )
            if not still_owed:
                Payment.objects.filter(pk=locked.payment_id).update(
                    requires_refund=False, updated_at=now
                )
        locked.status = status
        locked.resolution = note[:255]
        locked.resolved_by = actor if status in RESOLVED_REFUND_STATUSES else locked.resolved_by
        locked.resolved_at = now if status in RESOLVED_REFUND_STATUSES else None
        locked.save(
            update_fields=["status", "resolution", "resolved_by", "resolved_at", "updated_at"]
        )
    log_event(
        "refund.status_changed",
        refund_reference=locked.reference,
        refund_id=str(locked.pk),
        booking_id=str(locked.booking_id),
        status=status,
        amount=f"{locked.amount:.2f}",
        actor_id=str(actor.pk) if actor is not None and getattr(actor, "pk", None) else None,
    )
    return locked


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def payment_summary() -> dict:
    """Headline numbers for the admin payments screen."""
    today = timezone.localdate()
    net = ExpressionWrapper(
        F("amount") - F("refunded_amount"),
        output_field=DecimalField(max_digits=12, decimal_places=2),
    )
    captured = Payment.objects.filter(status__in=CAPTURED_PAYMENT_STATUSES)

    def collected(queryset) -> str:
        return f"{queryset.aggregate(total=Sum(net))['total'] or Decimal('0'):.2f}"

    counts = dict(
        Payment.objects.order_by()
        .values("status")
        .annotate(total=Count("pk"))
        .values_list("status", "total")
    )
    return {
        "currency": settings.DEFAULT_CURRENCY,
        "collected_today": collected(captured.filter(paid_at__date=today)),
        "collected_30_days": collected(
            captured.filter(paid_at__date__gt=today - timedelta(days=30))
        ),
        "refunded_total": f"{Payment.objects.aggregate(t=Sum('refunded_amount'))['t'] or 0:.2f}",
        "needs_refund": Payment.objects.filter(requires_refund=True).count(),
        "open_refunds": Refund.objects.filter(status__in=OPEN_REFUND_STATUSES).count(),
        "open": sum(counts.get(s, 0) for s in OPEN_PAYMENT_STATUSES),
        "by_status": {value: counts.get(value, 0) for value in PaymentStatus.values},
    }
