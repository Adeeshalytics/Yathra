"""
Read-side helpers for bookings: the customer dashboard's scopes and totals.

"Upcoming", "previous" and "cancelled" are defined here once, so the booking list, its filters
and the dashboard counts can never drift apart.
"""

from decimal import Decimal

from django.db.models import DecimalField, F, Q, QuerySet, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.payments.models import CAPTURED_PAYMENT_STATUSES, OPEN_REFUND_STATUSES, Payment, Refund

from .models import PAID_STATUSES, RELEASED_STATUSES, UNPAID_STATUSES, Booking, BookingStatus

SCOPES = ("upcoming", "past", "cancelled")
# Bookings that still hold seats for a journey ahead.
LIVE_STATUSES = (*UNPAID_STATUSES, BookingStatus.CONFIRMED)


def with_departure(queryset: QuerySet[Booking]) -> QuerySet[Booking]:
    """Annotate when this passenger's bus leaves — their boarding point, not the route's start."""
    return queryset.annotate(
        departure=Coalesce("boarding_time", "trip__departure_datetime"),
    )


def scoped(queryset: QuerySet[Booking], scope: str, *, now=None) -> QuerySet[Booking]:
    """One dashboard tab's bookings. `queryset` must carry the `departure` annotation."""
    now = now or timezone.now()
    if scope == "upcoming":
        return queryset.filter(status__in=LIVE_STATUSES, departure__gt=now)
    if scope == "past":
        return queryset.filter(
            Q(status=BookingStatus.COMPLETED) | Q(status__in=PAID_STATUSES, departure__lte=now)
        )
    if scope == "cancelled":
        return queryset.filter(status__in=RELEASED_STATUSES)
    return queryset


def dashboard_summary(bookings: QuerySet[Booking], *, now=None) -> dict:
    """Headline numbers for the account dashboard, over bookings already scoped to the viewer."""
    now = now or timezone.now()
    ids = bookings.values("pk")
    net = Sum(
        F("amount") - F("refunded_amount"),
        output_field=DecimalField(max_digits=12, decimal_places=2),
    )
    spent = Payment.objects.filter(booking__in=ids, status__in=CAPTURED_PAYMENT_STATUSES).aggregate(
        total=net
    )["total"] or Decimal("0")
    next_departure = (
        scoped(bookings, "upcoming", now=now)
        .order_by("departure")
        .values_list("departure", flat=True)
        .first()
    )
    return {
        "upcoming": scoped(bookings, "upcoming", now=now).count(),
        "past": scoped(bookings, "past", now=now).count(),
        "cancelled": scoped(bookings, "cancelled", now=now).count(),
        "total": bookings.count(),
        "spent": f"{spent:.2f}",
        "currency": Booking._meta.get_field("currency").default,
        "open_refunds": Refund.objects.filter(
            booking__in=ids, status__in=OPEN_REFUND_STATUSES
        ).count(),
        "next_departure": next_departure,
    }
