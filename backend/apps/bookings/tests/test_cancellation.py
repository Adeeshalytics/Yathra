"""
Phase 6: the cancellation policy decides what may be cancelled and what comes back.

Every number here comes from the server — the browser is only ever told the answer.
"""

from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.bookings.models import Booking
from apps.payments.models import Payment, Refund, RefundStatus

from .conftest import BOOKINGS, client_for, hold_and_book, lock

pytestmark = pytest.mark.django_db


def url(booking: dict, suffix: str = "") -> str:
    return f"{BOOKINGS}{booking['id']}/{suffix}"


def paid(client, staff, trip, *seats) -> dict:
    """A confirmed booking, paid at the counter."""
    booking = hold_and_book(client, trip, *(seats or ("15",))).json()
    response = client_for(staff).post(url(booking, "confirm/"))
    assert response.status_code == 200, response.content
    return response.json()


def departing_in(booking: dict, hours: float) -> None:
    """Move this passenger's boarding time, which is what the policy measures against."""
    Booking.objects.filter(pk=booking["id"]).update(
        boarding_time=timezone.now() + timedelta(hours=hours)
    )


class TestThePolicyIsServerSide:
    def test_the_server_states_the_rules_and_the_refund(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)

        body = client_for(alice).get(url(booking, "cancellation/")).json()

        assert body["allowed"] is True
        assert body["refundable"] is True
        assert (body["refund_amount"], body["currency"]) == ("2500.00", "LKR")
        assert body["refund_percent"] == "100"
        assert body["paid_amount"] == "2500.00"
        # The wording customers read is the server's, so one policy drives every client.
        assert any("48 hours or more" in rule for rule in body["rules"])
        assert any("support team" in rule for rule in body["rules"])
        assert body["deadline"] is not None

    @pytest.mark.parametrize(
        ("hours_before", "percent", "refund"),
        [(72, "100", "2500.00"), (30, "75", "1875.00"), (10, "50", "1250.00")],
    )
    def test_the_refund_shrinks_as_departure_approaches(
        self, trip, alice, staff, hours_before, percent, refund
    ):
        booking = paid(client_for(alice), staff, trip)
        departing_in(booking, hours_before)

        body = client_for(alice).get(url(booking, "cancellation/")).json()

        assert (body["refund_percent"], body["refund_amount"]) == (percent, refund)
        assert body["allowed"] is True

    def test_inside_the_cutoff_only_support_can_cancel(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)
        departing_in(booking, 3)

        customer_view = client_for(alice).get(url(booking, "cancellation/")).json()
        refused = client_for(alice).post(url(booking, "cancel/"), {"reason": "Too late"})
        staff_view = client_for(staff).get(url(booking, "cancellation/")).json()

        assert customer_view["allowed"] is False
        assert customer_view["code"] == "cutoff"
        assert "6 hours before departure" in customer_view["message"]
        assert refused.status_code == 409
        assert refused.json()["error"]["code"] == "cancellation_not_allowed"
        assert refused.json()["error"]["details"]["cancellation"]["code"] == "cutoff"
        assert Booking.objects.get(pk=booking["id"]).status == "confirmed"
        assert staff_view["allowed"] is True  # support can still step in

    def test_a_departed_booking_cannot_be_cancelled(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)
        departing_in(booking, -1)

        body = client_for(alice).get(url(booking, "cancellation/")).json()

        assert (body["allowed"], body["code"]) == (False, "departed")

    def test_unpaid_bookings_can_always_be_cancelled(self, trip, alice):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15").json()

        body = client.get(url(booking, "cancellation/")).json()

        assert (body["allowed"], body["refundable"]) == (True, False)
        assert body["message"].startswith("No payment has been taken")

    def test_finished_bookings_are_final_for_everyone(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)
        client_for(alice).post(url(booking, "cancel/"), {"reason": "Plans changed"})

        again = client_for(alice).post(url(booking, "cancel/"))
        by_staff = client_for(staff).post(url(booking, "cancel/"))

        assert (again.status_code, by_staff.status_code) == (409, 409)
        assert by_staff.json()["error"]["details"]["cancellation"]["code"] == "already_cancelled"
        assert Refund.objects.count() == 1  # no second refund from the retries

    @override_settings(
        BOOKING_CANCELLATION={
            "TIERS": "24:100",
            "CUTOFF_HOURS": 12,
            "FEE_PER_BOOKING": "250",
            "FEE_PERCENT": "0",
        }
    )
    def test_the_policy_is_configuration_not_code(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)

        body = client_for(alice).get(url(booking, "cancellation/")).json()

        assert (body["refund_percent"], body["fee"]) == ("100", "250.00")
        assert body["refund_amount"] == "2250.00"
        assert any("cancellation fee of LKR 250.00" in rule for rule in body["rules"])
        assert any("12 hours" in rule for rule in body["rules"])


class TestCancelling:
    def test_releases_the_seats_and_queues_the_refund(self, trip, alice, bob, staff):
        client = client_for(alice)
        booking = paid(client, staff, trip, "15")

        body = client.post(url(booking, "cancel/"), {"reason": "Family emergency"}).json()

        assert body["status"] == "cancelled"
        assert body["cancellation_reason"] == "Family emergency"
        assert body["cancelled_at"] is not None
        assert lock(client_for(bob), trip, "15").status_code == 201  # the seat is free again
        refund = Refund.objects.get(booking_id=booking["id"])
        assert (refund.status, str(refund.amount)) == (RefundStatus.REQUESTED, "2500.00")
        assert refund.requested_by_id == alice.pk
        assert refund.reference.startswith("RF")
        # The policy numbers are frozen onto the request, so a later rule change can't rewrite it.
        assert refund.breakdown["refund_percent"] == "100"
        assert refund.breakdown["paid_amount"] == "2500.00"
        assert Payment.objects.get(booking_id=booking["id"]).requires_refund is True

    def test_a_partial_refund_follows_the_tier(self, trip, alice, staff):
        client = client_for(alice)
        booking = paid(client, staff, trip)
        departing_in(booking, 30)

        body = client.post(url(booking, "cancel/"), {"reason": "Changed plans"}).json()

        [refund] = body["refunds"]
        assert (refund["amount"], refund["status"]) == ("1875.00", "requested")
        assert refund["reason"] == "Changed plans"

    @override_settings(
        BOOKING_CANCELLATION={"TIERS": "48:0", "CUTOFF_HOURS": 0, "FEE_PER_BOOKING": "0"}
    )
    def test_a_non_refundable_fare_makes_no_refund_request(self, trip, alice, staff):
        client = client_for(alice)
        booking = paid(client, staff, trip)

        body = client.post(url(booking, "cancel/"), {"reason": "Changed plans"}).json()

        assert body["status"] == "cancelled"
        assert body["refunds"] == []
        assert not Refund.objects.exists()
        assert Payment.objects.get(booking_id=booking["id"]).requires_refund is False

    def test_cancelling_an_unpaid_booking_takes_no_money_back(self, trip, alice):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15").json()

        body = client.post(url(booking, "cancel/"), {"reason": "Mistake"}).json()

        assert body["status"] == "cancelled"
        assert not Refund.objects.exists()

    def test_support_can_cancel_inside_the_cutoff_and_refunds_in_full(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)
        departing_in(booking, 2)

        body = client_for(staff).post(url(booking, "cancel/"), {"reason": "Bus broke down"}).json()

        assert body["status"] == "cancelled"
        [refund] = body["refunds"]
        assert refund["amount"] == "2500.00"

    def test_the_booking_shows_what_cancelling_would_cost(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)
        departing_in(booking, 30)

        body = client_for(alice).get(url(booking)).json()

        assert body["cancellation"]["allowed"] is True
        assert body["cancellation"]["refund_amount"] == "1875.00"
        assert "rules" not in body["cancellation"]  # the full policy has its own endpoint


class TestTripCancellation:
    def test_the_operator_cancelling_refunds_every_passenger(self, trip, alice, staff):
        booking = paid(client_for(alice), staff, trip)

        response = client_for(staff).post(
            f"/api/v1/admin/trips/{trip.pk}/cancel/", {"reason": "Floods"}
        )

        assert response.status_code == 200, response.content
        refund = Refund.objects.get(booking_id=booking["id"])
        assert (refund.status, str(refund.amount)) == (RefundStatus.REQUESTED, "2500.00")
        assert refund.breakdown["source"] == "trip_cancelled"
        assert refund.requested_by_id is None  # raised by the system, not a person
