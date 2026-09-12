"""
Raising refund requests.

Kept apart from `services.py` so the booking engine can raise a request (when a booking is
cancelled) without importing the payment services that import the booking engine back.
Moving the money — `set_refund_status` — lives in `services.py`.
"""

from decimal import Decimal

from django.db import IntegrityError, transaction

from apps.core.db import violated_constraint

from .models import (
    ONE_OPEN_REFUND_CONSTRAINT,
    OPEN_REFUND_STATUSES,
    REFUNDABLE_PAYMENT_STATUSES,
    Payment,
    Refund,
)


def refundable_payment(booking) -> Payment | None:
    """The payment a refund should go back through: the one still holding the most money."""
    live = [
        payment
        for payment in booking.payments.all()
        if payment.status in REFUNDABLE_PAYMENT_STATUSES
        and payment.amount > payment.refunded_amount
    ]
    return max(live, key=lambda payment: payment.amount - payment.refunded_amount, default=None)


def open_refunds(booking) -> list[Refund]:
    return list(booking.refunds.filter(status__in=OPEN_REFUND_STATUSES))


def request_refund(
    booking,
    *,
    amount,
    reason: str = "",
    requested_by=None,
    payment: Payment | None = None,
    breakdown: dict | None = None,
) -> Refund | None:
    """
    Ask the team to give `amount` back for this booking. Returns None when there is nothing to
    refund; when a request for the same payment is already open, that one is returned instead of
    a second one being raised.
    """
    amount = Decimal(amount)
    if amount <= 0:
        return None
    payment = payment or refundable_payment(booking)
    try:
        with transaction.atomic():
            return Refund.objects.create(
                booking=booking,
                payment=payment,
                amount=amount,
                currency=booking.currency,
                reason=reason[:255],
                requested_by=requested_by,
                breakdown=breakdown or {},
            )
    except IntegrityError as exc:
        if violated_constraint(exc) != ONE_OPEN_REFUND_CONSTRAINT:
            raise
        return Refund.objects.filter(payment=payment, status__in=OPEN_REFUND_STATUSES).first()
