"""
Phase 6 security: one customer must never reach another customer's booking.

Everything customer-facing is scoped to the signed-in account, so another customer's booking
doesn't 403 (which would confirm it exists) — it simply isn't there.
"""

import pytest
from rest_framework.test import APIClient

from apps.core.tests.factories import OperatorUserFactory
from apps.payments.models import Refund

from .conftest import BOOKINGS, client_for, hold_and_book

pytestmark = pytest.mark.django_db

PAYMENTS = "/api/v1/payments/"
REFUNDS = "/api/v1/refunds/"
ADMIN_REFUNDS = "/api/v1/admin/refunds/"


def url(booking: dict, suffix: str = "") -> str:
    return f"{BOOKINGS}{booking['id']}/{suffix}"


@pytest.fixture
def alices_booking(trip, alice, staff) -> dict:
    """A confirmed booking of Alice's, with a ticket, a payment and a refund request."""
    client = client_for(alice)
    booking = hold_and_book(client, trip, "15").json()
    confirmed = client_for(staff).post(url(booking, "confirm/")).json()
    return confirmed


class TestAnotherCustomersBooking:
    def test_is_invisible_in_every_read(self, alices_booking, bob):
        client = client_for(bob)

        assert client.get(url(alices_booking)).status_code == 404
        assert client.get(url(alices_booking, "ticket/")).status_code == 404
        assert client.get(url(alices_booking, "ticket/pdf/")).status_code == 404
        assert client.get(url(alices_booking, "cancellation/")).status_code == 404
        assert client.get(BOOKINGS).json()["count"] == 0
        assert client.get(f"{BOOKINGS}summary/").json()["total"] == 0

    def test_cannot_be_changed(self, alices_booking, bob):
        client = client_for(bob)
        passengers = [
            {"seat_number": "15", "name": "Bob", "phone": "0771234567", "email": "b@x.lk"}
        ]

        cancelled = client.post(url(alices_booking, "cancel/"), {"reason": "Not mine"})
        edited = client.patch(url(alices_booking), {"passengers": passengers}, format="json")

        assert cancelled.status_code == 404
        assert edited.status_code == 404
        assert client.post(url(alices_booking, "checkout/")).status_code == 404
        assert client.post(url(alices_booking, "confirm/")).status_code == 403  # admin only

    def test_cannot_be_paid_for(self, alices_booking, bob):
        response = client_for(bob).post(
            PAYMENTS, {"booking": alices_booking["id"], "provider": "mock"}, format="json"
        )

        assert response.status_code == 404

    def test_its_payments_and_refunds_stay_private(self, trip, alice, bob, staff):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "16").json()
        confirmed = client_for(staff).post(url(booking, "confirm/")).json()
        client.post(url(confirmed, "cancel/"), {"reason": "Plans changed"})
        refund = Refund.objects.get(booking_id=confirmed["id"])
        payment_id = confirmed["payment"]["id"]

        intruder = client_for(bob)
        assert intruder.get(f"{PAYMENTS}{payment_id}/").status_code == 404
        assert intruder.post(f"{PAYMENTS}{payment_id}/verify/").status_code == 404
        assert intruder.get(f"{REFUNDS}{refund.pk}/").status_code == 404
        assert intruder.get(REFUNDS).json()["count"] == 0
        assert client.get(REFUNDS).json()["count"] == 1  # the owner does see it


class TestRoles:
    def test_signed_out_visitors_get_nowhere(self, alices_booking):
        client = APIClient()

        assert client.get(BOOKINGS).status_code == 401
        assert client.get(url(alices_booking)).status_code == 401
        assert client.get(REFUNDS).status_code == 401
        assert client.patch("/api/v1/auth/me/", {"name": "Nobody"}).status_code == 401

    def test_operators_have_no_access_to_customer_bookings(self, alices_booking):
        client = client_for(OperatorUserFactory())

        assert client.get(BOOKINGS).status_code == 403
        assert client.get(url(alices_booking)).status_code == 403
        assert client.get(REFUNDS).status_code == 403

    def test_customers_cannot_reach_the_support_queues(self, alices_booking, alice):
        client = client_for(alice)

        assert client.get(ADMIN_REFUNDS).status_code == 403
        assert client.get("/api/v1/admin/payments/").status_code == 403

    def test_admins_see_every_booking(self, alices_booking, staff):
        client = client_for(staff)

        assert client.get(url(alices_booking)).status_code == 200
        assert client.get(BOOKINGS).json()["count"] == 1
        assert client.get(ADMIN_REFUNDS).status_code == 200
