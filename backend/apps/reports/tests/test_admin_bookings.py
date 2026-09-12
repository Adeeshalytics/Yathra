"""
Phase 7: the admin bookings screen.

Support looks bookings up by reference, customer or passenger, filters them by trip, route and
status, opens one, and cancels it on the customer's behalf.
"""

import pytest

from apps.audit.models import ActivityAction, ActivityLog
from apps.bookings.models import Booking, BookingStatus
from apps.payments.models import Refund, RefundStatus

from .conftest import ADMIN_BOOKINGS

pytestmark = pytest.mark.django_db


def listing(client, query: str = "") -> dict:
    response = client.get(f"{ADMIN_BOOKINGS}{query}")
    assert response.status_code == 200, response.content
    return response.json()


def references(body: dict) -> set[str]:
    return {row["booking_reference"] for row in body["results"]}


class TestTheList:
    def test_it_shows_every_column_the_screen_needs(self, admin_api, ledger):
        rows = {row["booking_reference"]: row for row in listing(admin_api)["results"]}
        row = rows[ledger.alice_booking["booking_reference"]]

        assert row["customer"]["name"] == "Alice Perera"
        assert row["customer"]["email"]
        assert row["route_name"] == "Colombo – Batticaloa"
        assert row["trip_code"] == ledger.trip.code
        assert row["departure"] and row["created_at"]
        assert (row["seats"], row["total_amount"], row["currency"]) == (2, "5000.00", "LKR")
        assert row["paid_amount"] == "5000.00"
        assert row["payment_status"] == "successful"
        assert (row["status"], row["status_label"]) == ("confirmed", "Confirmed")

    def test_it_lists_everybodys_bookings_newest_first(self, admin_api, ledger):
        body = listing(admin_api)

        assert body["count"] == 3
        assert (
            body["results"][0]["booking_reference"]
            == (ledger.cancelled_booking["booking_reference"])
        )

    def test_it_pages(self, admin_api, ledger):
        body = listing(admin_api, "?page_size=2")

        assert (body["count"], len(body["results"])) == (3, 2)
        assert body["next"] is not None


class TestSearchingAndFiltering:
    def test_by_booking_reference(self, admin_api, ledger):
        reference = ledger.bob_booking["booking_reference"]

        assert references(listing(admin_api, f"?search={reference}")) == {reference}

    def test_by_customer_name(self, admin_api, ledger):
        assert references(listing(admin_api, "?search=Alice")) == {
            ledger.alice_booking["booking_reference"]
        }

    def test_by_passenger_name_without_repeating_the_booking(self, admin_api, ledger):
        # Every seat is booked for the same passenger, and Alice booked two of them; the
        # booking must still appear once.
        body = listing(admin_api, "?search=Kasuni")

        assert body["count"] == 3
        assert len(body["results"]) == 3

    def test_by_status(self, admin_api, ledger):
        assert references(listing(admin_api, "?status=cancelled")) == {
            ledger.cancelled_booking["booking_reference"]
        }

    def test_by_payment_status(self, admin_api, ledger):
        assert len(listing(admin_api, "?payment_status=successful")["results"]) == 2

    def test_by_trip_and_route(self, admin_api, ledger):
        by_trip = listing(admin_api, f"?trip={ledger.kandy_trip.pk}")
        by_route = listing(admin_api, f"?route={ledger.kandy_trip.route_id}")

        assert (
            references(by_trip) == references(by_route) == {ledger.bob_booking["booking_reference"]}
        )

    def test_by_the_day_it_was_booked(self, admin_api, ledger):
        today = listing(admin_api, "?date_from=2020-01-01")
        long_ago = listing(admin_api, "?date_to=2020-01-01")

        assert (today["count"], long_ago["count"]) == (3, 0)

    def test_by_the_day_they_travel(self, admin_api, ledger):
        departure = ledger.kandy_trip.departure_datetime.date().isoformat()

        body = listing(admin_api, f"?departure_from={departure}&departure_to={departure}")

        assert references(body) == {ledger.bob_booking["booking_reference"]}


class TestOneBooking:
    def test_it_opens_in_full(self, admin_api, ledger):
        response = admin_api.get(f"{ADMIN_BOOKINGS}{ledger.alice_booking['id']}/")

        assert response.status_code == 200
        body = response.json()
        assert len(body["passengers"]) == 2
        assert body["boarding"]["stop"]["name"] == "Colombo"
        assert body["dropoff"]["stop"]["name"] == "Batticaloa"
        assert body["payment"]["status"] == "successful"
        assert body["ticket"]["ticket_number"]
        assert body["seats"] == ["15", "16"]

    def test_it_says_what_cancelling_would_cost(self, admin_api, ledger):
        response = admin_api.get(f"{ADMIN_BOOKINGS}{ledger.alice_booking['id']}/cancellation/")

        assert response.status_code == 200
        quote = response.json()
        assert quote["allowed"] is True
        assert quote["refund_amount"] == "5000.00"
        assert quote["rules"]


class TestCancellingForACustomer:
    def test_it_releases_the_seats_and_raises_a_refund(self, admin_api, ledger):
        booking_id = ledger.alice_booking["id"]

        response = admin_api.post(
            f"{ADMIN_BOOKINGS}{booking_id}/cancel/",
            {"reason": "Customer rang the office"},
            format="json",
        )

        assert response.status_code == 200, response.content
        booking = Booking.objects.get(pk=booking_id)
        assert booking.status == BookingStatus.CANCELLED
        assert booking.cancellation_reason == "Customer rang the office"
        assert booking.cancelled_at is not None
        assert booking.passengers.filter(holds_seat=True).count() == 0

        refund = Refund.objects.get(booking_id=booking_id)
        assert (refund.amount, refund.status) == (booking.total_amount, RefundStatus.REQUESTED)

    def test_it_is_written_to_the_activity_log(self, admin_api, ledger, admin_user):
        admin_api.post(
            f"{ADMIN_BOOKINGS}{ledger.alice_booking['id']}/cancel/",
            {"reason": "Customer rang the office"},
            format="json",
        )

        entry = ActivityLog.objects.filter(action=ActivityAction.CANCELLED).first()
        assert entry.actor_id == admin_user.pk
        assert entry.changes["reason"] == "Customer rang the office"

    def test_a_reason_is_optional(self, admin_api, ledger):
        response = admin_api.post(
            f"{ADMIN_BOOKINGS}{ledger.alice_booking['id']}/cancel/", {}, format="json"
        )

        assert response.status_code == 200, response.content
        assert Booking.objects.get(pk=ledger.alice_booking["id"]).cancellation_reason == ""

    def test_an_already_cancelled_booking_is_refused(self, admin_api, ledger):
        response = admin_api.post(
            f"{ADMIN_BOOKINGS}{ledger.cancelled_booking['id']}/cancel/",
            {"reason": "Again"},
            format="json",
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "cancellation_not_allowed"


class TestItIsAdminsOnly:
    def test_a_customer_cannot_see_the_platforms_bookings(self, api_client, alice, ledger):
        api_client.force_authenticate(alice)

        assert api_client.get(ADMIN_BOOKINGS).status_code == 403

    def test_a_customer_cannot_cancel_through_the_admin_route(self, api_client, alice, ledger):
        api_client.force_authenticate(alice)

        response = api_client.post(
            f"{ADMIN_BOOKINGS}{ledger.alice_booking['id']}/cancel/",
            {"reason": "Mine"},
            format="json",
        )

        assert response.status_code == 403

    def test_an_operator_cannot_either(self, api_client, operator_user, ledger):
        api_client.force_authenticate(operator_user)

        assert api_client.get(ADMIN_BOOKINGS).status_code == 403

    def test_a_stranger_is_turned_away(self, api_client, ledger):
        assert api_client.get(ADMIN_BOOKINGS).status_code == 401
