"""
The cancellation policy: when a booking may be cancelled, and how much comes back.

The rules live in the ``BOOKING_CANCELLATION`` setting (environment-driven), never in the
browser: the API answers "may I cancel, and what would I get back?", so every client — and a
future admin-managed policy — shows the same numbers. Swap `CancellationPolicy.current()` for a
database-backed policy later and nothing else has to change.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.conf import settings
from django.utils import timezone

from apps.payments.models import CAPTURED_PAYMENT_STATUSES

from .models import PAID_STATUSES, UNPAID_STATUSES, Booking, BookingStatus

MONEY = Decimal("0.01")
HUNDRED = Decimal("100")


def _money(value) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class RefundTier:
    """From `hours_before` hours before departure onwards, this share comes back."""

    hours_before: int
    refund_percent: Decimal

    def describe(self) -> str:
        if self.refund_percent >= HUNDRED:
            share = "in full"
        elif self.refund_percent > 0:
            share = f"{self.refund_percent.normalize():f}% back"
        else:
            share = "with no refund"
        return f"{self.hours_before} hours or more before departure: {share}"


@dataclass(frozen=True)
class CancellationPolicy:
    tiers: tuple[RefundTier, ...]
    cutoff_hours: int
    fee_per_booking: Decimal
    fee_percent: Decimal

    @classmethod
    def current(cls) -> "CancellationPolicy":
        config = getattr(settings, "BOOKING_CANCELLATION", {})
        return cls(
            tiers=cls._parse_tiers(config.get("TIERS", "")),
            cutoff_hours=int(config.get("CUTOFF_HOURS", 0) or 0),
            fee_per_booking=_money(config.get("FEE_PER_BOOKING", "0") or 0),
            fee_percent=Decimal(str(config.get("FEE_PERCENT", "0") or 0)),
        )

    @staticmethod
    def _parse_tiers(raw) -> tuple[RefundTier, ...]:
        """Parses "48:100,24:75" (hours before departure : percent) — most generous first."""
        entries = raw.split(",") if isinstance(raw, str) else list(raw or [])
        tiers = []
        for entry in entries:
            hours, _, percent = str(entry).partition(":")
            try:
                tiers.append(RefundTier(int(hours.strip()), Decimal(percent.strip() or "0")))
            except (ValueError, InvalidOperation):
                continue  # a typo in the setting must not break cancelling
        return tuple(sorted(tiers, key=lambda tier: tier.hours_before, reverse=True))

    def refund_percent_for(self, hours_before: Decimal) -> Decimal:
        for tier in self.tiers:
            if hours_before >= tier.hours_before:
                return tier.refund_percent
        return Decimal("0")

    def fee_on(self, amount: Decimal) -> Decimal:
        fee = self.fee_per_booking + (amount * self.fee_percent / HUNDRED)
        return min(_money(fee), amount)

    def rules(self) -> list[str]:
        """Plain-English policy lines for customers (the UI prints what the server says)."""
        lines = [tier.describe() for tier in self.tiers]
        if self.cutoff_hours:
            lines.append(
                f"Less than {self.cutoff_hours} hours before departure, bookings can only be "
                "cancelled by our support team."
            )
        parts = []
        if self.fee_per_booking:
            parts.append(f"{settings.DEFAULT_CURRENCY} {self.fee_per_booking:,.2f}")
        if self.fee_percent:
            parts.append(f"{self.fee_percent.normalize():f}% of the fare")
        if parts:
            lines.append(f"A cancellation fee of {' plus '.join(parts)} is kept from the refund.")
        lines.append("Refunds go back the way you paid, usually within 5–7 working days.")
        return lines


def amount_paid(booking: Booking) -> Decimal:
    """Money we are still holding for this booking: captured payments minus refunds."""
    captured = [
        payment for payment in booking.payments.all() if payment.status in CAPTURED_PAYMENT_STATUSES
    ]
    return _money(sum((p.amount - p.refunded_amount for p in captured), Decimal("0")))


@dataclass(frozen=True)
class CancellationQuote:
    """What would happen if this booking were cancelled right now."""

    allowed: bool
    code: str
    message: str
    refund_amount: Decimal
    refund_percent: Decimal
    fee: Decimal
    paid_amount: Decimal
    currency: str
    hours_before_departure: Decimal | None
    deadline: datetime | None
    rules: list[str]

    @property
    def refundable(self) -> bool:
        return self.refund_amount > 0

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "code": self.code,
            "message": self.message,
            "refundable": self.refundable,
            "refund_amount": f"{self.refund_amount:.2f}",
            "refund_percent": f"{self.refund_percent.normalize():f}",
            "fee": f"{self.fee:.2f}",
            "paid_amount": f"{self.paid_amount:.2f}",
            "currency": self.currency,
            "hours_before_departure": (
                None
                if self.hours_before_departure is None
                else float(round(self.hours_before_departure, 1))
            ),
            "deadline": self.deadline,
            "rules": self.rules,
        }


def departure_of(booking: Booking) -> datetime:
    """When this passenger's bus leaves (their boarding point, not the route's origin)."""
    return booking.boarding_time or booking.trip.departure_datetime


def quote(booking: Booking, *, now=None, staff: bool = False) -> CancellationQuote:
    """
    Evaluate the policy for one booking. `staff` lets support cancel outside the rules: the
    customer then gets everything they paid back, as a refund request the team can adjust.
    """
    now = now or timezone.now()
    policy = CancellationPolicy.current()
    paid = amount_paid(booking)
    departure = departure_of(booking)
    hours_before = (
        Decimal((departure - now).total_seconds()) / Decimal("3600") if departure else None
    )
    deadline = (
        departure - timedelta(hours=policy.cutoff_hours)
        if departure and policy.cutoff_hours
        else departure
    )

    def refused(code: str, message: str, *, final: bool = False) -> CancellationQuote:
        # `final` states are over for everyone; the rest are the support team's to override.
        allowed = staff and not final
        return CancellationQuote(
            allowed=allowed,
            code=code,
            message=message,
            refund_amount=paid if allowed else Decimal("0.00"),
            refund_percent=HUNDRED if allowed and paid else Decimal("0"),
            fee=Decimal("0.00"),
            paid_amount=paid,
            currency=booking.currency,
            hours_before_departure=hours_before,
            deadline=deadline,
            rules=policy.rules(),
        )

    if booking.status == BookingStatus.CANCELLED:
        return refused("already_cancelled", "This booking has already been cancelled.", final=True)
    if booking.status == BookingStatus.EXPIRED:
        return refused(
            "expired", "This booking expired, so there is nothing to cancel.", final=True
        )
    if booking.status == BookingStatus.COMPLETED:
        return refused(
            "completed", "This journey is over, so it can no longer be cancelled.", final=True
        )

    if booking.status in UNPAID_STATUSES:
        return CancellationQuote(
            allowed=True,
            code="",
            message="No payment has been taken, so cancelling only releases your seats.",
            refund_amount=Decimal("0.00"),
            refund_percent=Decimal("0"),
            fee=Decimal("0.00"),
            paid_amount=paid,
            currency=booking.currency,
            hours_before_departure=hours_before,
            deadline=deadline,
            rules=policy.rules(),
        )

    if booking.status in PAID_STATUSES and hours_before is not None:
        if hours_before <= 0:
            return refused(
                "departed", "The bus has already left, so this booking can no longer be cancelled."
            )
        if hours_before < policy.cutoff_hours:
            return refused(
                "cutoff",
                f"Bookings can only be cancelled up to {policy.cutoff_hours} hours before "
                "departure. Please contact our support team.",
            )

    percent = policy.refund_percent_for(hours_before if hours_before is not None else Decimal("0"))
    gross = _money(paid * percent / HUNDRED)
    fee = policy.fee_on(gross)
    refund = _money(gross - fee)
    if refund > 0:
        message = (
            f"Cancelling now refunds {booking.currency} {refund:,.2f} of the "
            f"{booking.currency} {paid:,.2f} you paid."
        )
    elif paid > 0:
        message = "Cancelling now releases your seats, but this booking is no longer refundable."
    else:
        message = "Cancelling releases your seats."
    return CancellationQuote(
        allowed=True,
        code="",
        message=message,
        refund_amount=refund,
        refund_percent=percent,
        fee=fee,
        paid_amount=paid,
        currency=booking.currency,
        hours_before_departure=hours_before,
        deadline=deadline,
        rules=policy.rules(),
    )
