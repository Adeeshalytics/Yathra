from decimal import Decimal

import pytest

from apps.bookings import pricing
from apps.bookings.pricing import quote
from apps.trips.models import Trip

from .conftest import client_for, hold_and_book, lock

pytestmark = pytest.mark.django_db


def amounts(q):
    return (q.unit_price, q.subtotal, q.service_fee, q.discount, q.tax, q.total)


def test_ticket_price_times_seats(trip):
    assert amounts(quote(trip, 3)) == (
        Decimal("2500.00"),
        Decimal("7500.00"),
        Decimal("0.00"),
        Decimal("0.00"),
        Decimal("0.00"),
        Decimal("7500.00"),
    )


def test_service_fees_and_tax(trip, settings):
    settings.BOOKING_PRICING = {
        "SERVICE_FEE_PER_SEAT": "50",
        "SERVICE_FEE_PERCENT": "2.5",
        "TAX_PERCENT": "8",
    }

    q = quote(trip, 2)

    # fee = 2 × 50 + 2.5% of 5 000; tax = 8% of (5 000 + 225)
    assert (q.subtotal, q.service_fee, q.tax, q.total) == (
        Decimal("5000.00"),
        Decimal("225.00"),
        Decimal("418.00"),
        Decimal("5643.00"),
    )


def test_amounts_are_rounded_to_cents(trip, settings):
    Trip.objects.filter(pk=trip.pk).update(base_price=Decimal("333.33"))
    trip.refresh_from_db()
    settings.BOOKING_PRICING = {"TAX_PERCENT": "10"}

    q = quote(trip, 3)

    assert (q.subtotal, q.tax, q.total) == (
        Decimal("999.99"),
        Decimal("100.00"),
        Decimal("1099.99"),
    )


def test_discounts_never_exceed_what_is_owed(trip, monkeypatch):
    monkeypatch.setattr(pricing, "discount_for", lambda *args, **kwargs: Decimal("99999"))

    q = quote(trip, 2)

    assert (q.discount, q.total) == (Decimal("5000.00"), Decimal("0.00"))


def test_holds_and_bookings_use_the_server_quote(trip, alice, settings):
    settings.BOOKING_PRICING = {"SERVICE_FEE_PER_SEAT": "100"}
    client = client_for(alice)

    hold = lock(client, trip, "15").json()
    booking = hold_and_book(client, trip, "15").json()

    assert hold["quote"]["total"] == "2600.00"
    assert (booking["price"]["service_fee"], booking["total_amount"]) == ("100.00", "2600.00")
