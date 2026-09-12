"""
One day's trading, built once and reported on from every angle.

The numbers below are the yardstick for the whole Phase 7 suite: two routes, three paid
bookings, one of them cancelled and refunded. Every assertion elsewhere traces back here.
"""

from dataclasses import dataclass
from decimal import Decimal

import pytest

from apps.bookings.models import Booking
from apps.bookings.tests.conftest import (  # noqa: F401 — shared fixtures
    alice,
    bob,
    bus,
    client_for,
    hold_and_book,
    make_trip,
    route,
    staff,
    trip,
)
from apps.core.tests.factories import (
    CustomerFactory,
    create_bookable_bus,
    create_route_with_stops,
)
from apps.payments.models import Payment, Refund, RefundStatus
from apps.payments.services import set_refund_status
from apps.trips.tests.conftest import local_datetime

REPORTS = "/api/v1/admin/reports/"
ADMIN_BOOKINGS = "/api/v1/admin/bookings/"
ADMIN_PASSENGERS = "/api/v1/admin/passengers/"
CHARTS = "/api/v1/admin/dashboard/charts/"

KANDY_PLAN = (
    ("Colombo", 0, 0),
    ("Kegalle", 90, 95),
    ("Kandy", 180, 180),
)


def report_url(key: str, **params) -> str:
    query = "&".join(f"{name}={value}" for name, value in params.items())
    return f"{REPORTS}{key}/" + (f"?{query}" if query else "")


def book_and_pay(customer, on_trip, staff_user, *seats, **stops) -> dict:
    """A booking paid at the counter — the shortest route to confirmed money."""
    booking = hold_and_book(client_for(customer), on_trip, *seats, **stops).json()
    response = client_for(staff_user).post(f"/api/v1/bookings/{booking['id']}/confirm/")
    assert response.status_code == 200, response.content
    return response.json()


@dataclass
class Ledger:
    """What the fixture built, so tests can assert against names rather than magic values."""

    trip: object
    kandy_trip: object
    alice_booking: dict
    bob_booking: dict
    cancelled_booking: dict
    refund: Refund

    @property
    def bookings(self) -> int:
        return 3

    @property
    def seats_sold(self) -> int:
        """Seats still held: Alice's two and Bob's one (the cancelled seat went back)."""
        return 3

    @property
    def capacity(self) -> int:
        return 41 + 41


@pytest.fixture
def kandy_route(db):
    return create_route_with_stops("Colombo – Kandy", KANDY_PLAN, base_fare=Decimal("1200.00"))


@pytest.fixture
def kandy_trip(kandy_route):
    return make_trip(
        kandy_route,
        create_bookable_bus(registration_number="WP NC-7788"),
        local_datetime(5, 6, 30),
    )


@pytest.fixture
def ledger(trip, kandy_trip, alice, bob, staff) -> Ledger:
    alice_booking = book_and_pay(alice, trip, staff, "15", "16")  # 2 × 2500
    bob_booking = book_and_pay(bob, kandy_trip, staff, "20", dropoff="Kandy")  # 1 × 1200

    carol = CustomerFactory(name="Carol Jayasuriya")
    cancelled = book_and_pay(carol, trip, staff, "21")  # 2500, cancelled below
    response = client_for(carol).post(
        f"/api/v1/bookings/{cancelled['id']}/cancel/",
        {"reason": "Meeting moved"},
        format="json",
    )
    assert response.status_code == 200, response.content
    cancelled = response.json()

    # Settle the refund so the revenue and payment reports have something to net off.
    refund = Refund.objects.get(booking_id=cancelled["id"])
    set_refund_status(refund, status=RefundStatus.COMPLETED, actor=staff)
    refund.refresh_from_db()

    return Ledger(
        trip=trip,
        kandy_trip=kandy_trip,
        alice_booking=alice_booking,
        bob_booking=bob_booking,
        cancelled_booking=cancelled,
        refund=refund,
    )


@pytest.fixture
def paid_payments(ledger) -> list[Payment]:
    return list(Payment.objects.order_by("created_at"))


@pytest.fixture
def booking_ids(ledger) -> dict[str, str]:
    return {booking.booking_reference: str(booking.pk) for booking in Booking.objects.all()}
