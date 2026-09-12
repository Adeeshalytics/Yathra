"""
Phase 7: passenger management and the printed trip manifest.

The office answers "who is on this bus?" by trip, route, date, bus or booking, and the crew
marks people aboard as they get on.
"""

import pytest

from apps.bookings.models import Passenger

from .conftest import ADMIN_PASSENGERS

pytestmark = pytest.mark.django_db


def listing(client, query: str = "") -> dict:
    response = client.get(f"{ADMIN_PASSENGERS}{query}")
    assert response.status_code == 200, response.content
    return response.json()


def manifest_url(trip, suffix: str = "") -> str:
    return f"/api/v1/admin/trips/{trip.pk}/manifest/{suffix}"


class TestTheList:
    def test_every_column_the_screen_shows(self, admin_api, ledger):
        row = listing(admin_api, f"?trip={ledger.trip.pk}")["results"][0]

        assert row["name"] == "Kasuni Fernando"
        assert row["phone"]
        assert row["booking_reference"]
        assert row["seat_number"] in {"15", "16", "21"}
        assert row["boarding_point"] == "Colombo"
        assert row["dropoff_point"] == "Batticaloa"
        assert row["payment_status"] == "successful"
        assert row["boarding_status"] == "expected"
        assert row["route_name"] == "Colombo – Batticaloa"
        assert row["bus_registration"]
        assert row["departure"]

    def test_it_covers_everyone_who_ever_had_a_seat(self, admin_api, ledger):
        assert listing(admin_api)["count"] == 4

    def test_it_pages(self, admin_api, ledger):
        body = listing(admin_api, "?page_size=2")

        assert (body["count"], len(body["results"])) == (4, 2)


class TestFindingPassengers:
    def test_by_trip(self, admin_api, ledger):
        assert listing(admin_api, f"?trip={ledger.trip.pk}")["count"] == 3

    def test_by_route(self, admin_api, ledger):
        assert listing(admin_api, f"?route={ledger.kandy_trip.route_id}")["count"] == 1

    def test_by_bus(self, admin_api, ledger):
        assert listing(admin_api, f"?bus={ledger.kandy_trip.bus_id}")["count"] == 1

    def test_by_the_day_they_travel(self, admin_api, ledger):
        day = ledger.kandy_trip.departure_datetime.date().isoformat()

        assert listing(admin_api, f"?date={day}")["count"] == 1

    def test_by_booking(self, admin_api, ledger):
        body = listing(admin_api, f"?booking={ledger.alice_booking['id']}")

        assert body["count"] == 2
        assert {row["seat_number"] for row in body["results"]} == {"15", "16"}

    def test_by_search(self, admin_api, ledger):
        reference = ledger.bob_booking["booking_reference"]

        assert listing(admin_api, f"?search={reference}")["count"] == 1

    def test_the_cancelled_seat_is_no_longer_expected(self, admin_api, ledger):
        expected = listing(admin_api, "?boarding_status=expected")
        released = listing(admin_api, "?boarding_status=released")

        assert (expected["count"], released["count"]) == (3, 1)


class TestBoarding:
    def test_the_crew_can_check_someone_on(self, admin_api, ledger):
        passenger = listing(admin_api, f"?trip={ledger.trip.pk}")["results"][0]

        response = admin_api.post(
            f"{ADMIN_PASSENGERS}{passenger['id']}/boarding/", {"boarded": True}, format="json"
        )

        assert response.status_code == 200, response.content
        assert response.json()["boarding_status"] == "boarded"
        assert response.json()["boarded_at"] is not None
        assert Passenger.objects.get(pk=passenger["id"]).boarded_at is not None

    def test_and_undo_it(self, admin_api, ledger):
        passenger = listing(admin_api, f"?trip={ledger.trip.pk}")["results"][0]
        admin_api.post(f"{ADMIN_PASSENGERS}{passenger['id']}/boarding/", {}, format="json")

        response = admin_api.post(
            f"{ADMIN_PASSENGERS}{passenger['id']}/boarding/", {"boarded": False}, format="json"
        )

        assert response.json()["boarding_status"] == "expected"
        assert Passenger.objects.get(pk=passenger["id"]).boarded_at is None

    def test_boarded_passengers_can_be_filtered_out(self, admin_api, ledger):
        passenger = listing(admin_api, f"?trip={ledger.trip.pk}")["results"][0]
        admin_api.post(f"{ADMIN_PASSENGERS}{passenger['id']}/boarding/", {}, format="json")

        assert listing(admin_api, "?boarding_status=boarded")["count"] == 1


class TestTheManifest:
    def test_it_heads_the_page_with_the_journey(self, admin_api, ledger):
        response = admin_api.get(manifest_url(ledger.trip))

        assert response.status_code == 200, response.content
        heading = response.json()["trip"]
        assert heading["route_name"] == "Colombo – Batticaloa"
        assert (heading["origin"], heading["destination"]) == ("Colombo", "Batticaloa")
        assert heading["departure_time"] == "8:30 PM"
        assert heading["departure_date"]
        assert heading["bus_registration"]

    def test_it_lists_the_travelling_passengers_in_seat_order(self, admin_api, ledger):
        body = admin_api.get(manifest_url(ledger.trip)).json()

        assert [row["seat_number"] for row in body["passengers"]] == ["15", "16"]
        assert [column["header"] for column in body["columns"]][:5] == [
            "Seat",
            "Passenger",
            "Phone",
            "Boarding",
            "Drop-off",
        ]
        assert body["passengers"][0]["boarding_point"] == "Colombo"
        assert body["printed_at"]

    def test_it_counts_the_bus(self, admin_api, ledger):
        counts = admin_api.get(manifest_url(ledger.trip)).json()["counts"]

        assert (counts["passengers"], counts["capacity"]) == (2, 41)
        assert (counts["boarded"], counts["empty_seats"]) == (0, 39)
        assert counts["occupancy"] == 4.9

    def test_it_prints(self, admin_api, ledger):
        response = admin_api.get(manifest_url(ledger.trip, "pdf/"), HTTP_ACCEPT="text/html")

        assert response.status_code == 200
        assert response["Content-Type"] == "application/pdf"
        assert "attachment; filename=" in response["Content-Disposition"]
        body = b"".join(response.streaming_content) if response.streaming else response.content
        assert body.startswith(b"%PDF-")


class TestItIsAdminsOnly:
    def test_a_customer_cannot_read_the_passenger_list(self, api_client, alice, ledger):
        api_client.force_authenticate(alice)

        assert api_client.get(ADMIN_PASSENGERS).status_code == 403

    def test_a_customer_cannot_mark_anyone_aboard(self, api_client, alice, admin_api, ledger):
        passenger = listing(admin_api, f"?trip={ledger.trip.pk}")["results"][0]
        api_client.force_authenticate(alice)

        response = api_client.post(
            f"{ADMIN_PASSENGERS}{passenger['id']}/boarding/", {}, format="json"
        )

        assert response.status_code == 403

    def test_a_customer_cannot_print_the_manifest(self, api_client, alice, ledger):
        api_client.force_authenticate(alice)

        assert api_client.get(manifest_url(ledger.trip, "pdf/")).status_code == 403

    def test_an_operator_cannot_either(self, api_client, operator_user, ledger):
        api_client.force_authenticate(operator_user)

        assert api_client.get(ADMIN_PASSENGERS).status_code == 403

    def test_a_stranger_is_turned_away(self, api_client, ledger):
        assert api_client.get(ADMIN_PASSENGERS).status_code == 401
