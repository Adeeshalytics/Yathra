import uuid

import pytest

from apps.bookings.models import BookingStatus, Passenger
from apps.core.tests.factories import BookingFactory
from apps.fleet.models import Bus, Seat
from apps.routes.models import Stop
from apps.trips.models import Trip

from .conftest import local_datetime
from .test_public_search import make_trip

pytestmark = pytest.mark.django_db


@pytest.fixture
def trip(route, bus):
    return make_trip(route, bus, local_datetime(4, 20, 30))


def url(trip, suffix=""):
    return f"/api/v1/trips/{trip.pk}/{suffix}"


def book(trip, *seats, status=BookingStatus.CONFIRMED):
    booking = BookingFactory(trip=trip, status=status)
    for seat in seats:
        Passenger.objects.create(booking=booking, name=f"Passenger {seat}", seat_number=seat)


class TestDetail:
    def test_shows_the_route_stops_and_bus(self, api_client, trip):
        book(trip, "1", "2")

        body = api_client.get(url(trip)).json()

        assert body["code"] == trip.code
        assert body["route"]["origin"]["name"] == "Colombo"
        assert body["route"]["destination"]["name"] == "Batticaloa"
        assert [stop["stop"]["name"] for stop in body["stops"]] == [
            "Colombo",
            "Kadawatha",
            "Kurunegala",
            "Dambulla",
            "Batticaloa",
        ]
        assert body["duration_minutes"] == 540
        assert body["bus"]["bus_type_label"]
        assert body["bus"]["seat_layout_name"]
        assert (body["price"], body["available_seats"]) == ("2500.00", 39)

    @pytest.mark.parametrize(
        "hide",
        [
            lambda trip: Trip.objects.filter(pk=trip.pk).update(status="cancelled"),
            lambda trip: Trip.objects.filter(pk=trip.pk).update(active=False),
            lambda trip: Bus.objects.filter(pk=trip.bus_id).update(active=False),
        ],
        ids=["cancelled", "off-sale", "bus-inactive"],
    )
    def test_trips_not_on_sale_are_not_found(self, api_client, trip, hide):
        hide(trip)

        assert api_client.get(url(trip)).status_code == 404
        assert api_client.get(url(trip, "seats/")).status_code == 404

    def test_unknown_trip(self, api_client, route):
        response = api_client.get(f"/api/v1/trips/{uuid.uuid4()}/")

        assert response.status_code == 404


class TestStops:
    def test_lists_valid_boarding_and_dropoff_points(self, api_client, trip):
        body = api_client.get(url(trip, "stops/")).json()

        assert len(body["stops"]) == 5
        assert [p["stop"]["name"] for p in body["boarding_points"]] == [
            "Colombo",
            "Kadawatha",
            "Kurunegala",
            "Dambulla",
        ]
        assert [p["stop"]["name"] for p in body["dropoff_points"]] == [
            "Kadawatha",
            "Kurunegala",
            "Dambulla",
            "Batticaloa",
        ]

    def test_dropoffs_after_a_chosen_boarding_point(self, api_client, trip):
        kurunegala = Stop.objects.get(name="Kurunegala")

        body = api_client.get(url(trip, "stops/"), {"boarding": str(kurunegala.pk)}).json()

        assert [p["stop"]["name"] for p in body["dropoff_points"]] == ["Dambulla", "Batticaloa"]

    def test_the_destination_is_not_a_boarding_point(self, api_client, trip):
        batticaloa = Stop.objects.get(name="Batticaloa")

        response = api_client.get(url(trip, "stops/"), {"boarding": str(batticaloa.pk)})

        assert response.status_code == 400
        assert "boarding" in response.json()["error"]["details"]


class TestSeats:
    def test_every_seat_has_a_status(self, api_client, trip, bus):
        layout = bus.seat_layout
        Seat.objects.filter(layout=layout, seat_number="5").update(seat_type="reserved")
        Seat.objects.filter(layout=layout, seat_number="6").update(is_available=False)
        Bus.objects.filter(pk=bus.pk).update(seat_capacity=30)  # the back seats aren't sold
        book(trip, "1", "2")
        book(trip, "3", status=BookingStatus.CANCELLED)

        body = api_client.get(url(trip, "seats/")).json()
        status = {seat["seat_number"]: seat["status"] for seat in body["seats"]}
        driver = next(seat for seat in body["seats"] if seat["seat_type"] == "driver")

        assert (status["1"], status["2"]) == ("booked", "booked")
        assert status["3"] == "available"  # the cancelled booking freed it
        assert (status["5"], status["6"]) == ("blocked", "blocked")
        assert status["41"] == "blocked"
        assert driver["status"] == "blocked"
        assert body["available_seats"] == 28
        assert body["available_seats"] == sum(s["status"] == "available" for s in body["seats"])
        assert (body["booked_seats"], body["seat_capacity"]) == (2, 30)
        assert body["layout"]["rows"] >= 10
