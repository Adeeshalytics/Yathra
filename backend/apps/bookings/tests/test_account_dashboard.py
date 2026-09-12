"""Phase 6: the customer dashboard — upcoming, previous and cancelled bookings, and totals."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.bookings.models import Booking

from .conftest import BOOKINGS, client_for, hold_and_book

pytestmark = pytest.mark.django_db


def url(booking: dict, suffix: str = "") -> str:
    return f"{BOOKINGS}{booking['id']}/{suffix}"


def paid(client, staff, trip, seat: str) -> dict:
    booking = hold_and_book(client, trip, seat).json()
    return client_for(staff).post(url(booking, "confirm/")).json()


@pytest.fixture
def history(trip, alice, staff) -> dict:
    """One booking in each tab: a trip to come, one already travelled, and a cancelled one."""
    client = client_for(alice)
    upcoming = paid(client, staff, trip, "15")
    travelled = paid(client, staff, trip, "16")
    Booking.objects.filter(pk=travelled["id"]).update(
        boarding_time=timezone.now() - timedelta(days=1)
    )
    cancelled = hold_and_book(client, trip, "17").json()
    client.post(url(cancelled, "cancel/"), {"reason": "Changed plans"})
    waiting = hold_and_book(client, trip, "18").json()
    return {
        "upcoming": upcoming,
        "travelled": travelled,
        "cancelled": cancelled,
        "waiting": waiting,
    }


class TestScopes:
    def test_upcoming_shows_the_trips_still_to_come_soonest_first(self, history, alice):
        body = client_for(alice).get(BOOKINGS, {"scope": "upcoming"}).json()

        references = [row["booking_reference"] for row in body["results"]]
        assert body["count"] == 2
        assert history["upcoming"]["booking_reference"] in references
        assert history["waiting"]["booking_reference"] in references
        assert history["travelled"]["booking_reference"] not in references

    def test_previous_trips_are_the_ones_already_travelled(self, history, alice):
        body = client_for(alice).get(BOOKINGS, {"scope": "past"}).json()

        assert [row["booking_reference"] for row in body["results"]] == [
            history["travelled"]["booking_reference"]
        ]

    def test_cancelled_bookings_have_their_own_tab(self, history, alice):
        body = client_for(alice).get(BOOKINGS, {"scope": "cancelled"}).json()

        assert [row["booking_reference"] for row in body["results"]] == [
            history["cancelled"]["booking_reference"]
        ]

    def test_the_whole_history_is_one_list(self, history, alice):
        body = client_for(alice).get(BOOKINGS).json()

        assert body["count"] == 4

    def test_history_can_be_searched_and_narrowed(self, history, alice):
        client = client_for(alice)
        reference = history["travelled"]["booking_reference"]

        by_reference = client.get(BOOKINGS, {"search": reference}).json()
        by_status = client.get(BOOKINGS, {"status": "cancelled"}).json()
        by_date = client.get(
            BOOKINGS, {"date_from": (timezone.now() + timedelta(days=1)).date().isoformat()}
        ).json()

        assert [row["booking_reference"] for row in by_reference["results"]] == [reference]
        assert by_status["count"] == 1
        assert by_date["count"] == 3  # everything except the trip already travelled


class TestSummary:
    def test_counts_totals_and_the_next_departure(self, history, alice):
        body = client_for(alice).get(f"{BOOKINGS}summary/").json()

        assert (body["upcoming"], body["past"], body["cancelled"]) == (2, 1, 1)
        assert body["total"] == 4
        assert body["spent"] == "5000.00"  # two paid seats; unpaid bookings don't count
        assert body["currency"] == "LKR"
        assert body["open_refunds"] == 0
        assert body["next_departure"] is not None

    def test_a_cancelled_paid_booking_shows_its_refund(self, trip, alice, staff):
        client = client_for(alice)
        booking = paid(client, staff, trip, "15")
        client.post(url(booking, "cancel/"), {"reason": "Plans changed"})

        body = client.get(f"{BOOKINGS}summary/").json()

        assert (body["cancelled"], body["open_refunds"]) == (1, 1)

    def test_each_customer_only_counts_their_own(self, history, bob):
        body = client_for(bob).get(f"{BOOKINGS}summary/").json()

        assert (body["total"], body["spent"]) == (0, "0.00")
