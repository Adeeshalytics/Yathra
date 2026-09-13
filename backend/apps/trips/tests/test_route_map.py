"""
Coordinates for the route map.

The map is drawn from the stops the trip and route endpoints already return — there is no
separate map endpoint — so these tests pin the two things the map depends on: every stop
carries its coordinates, and the stops arrive in travel order.
"""

from decimal import Decimal

import pytest

from apps.routes.models import Stop

from .conftest import local_datetime
from .test_public_search import make_trip

pytestmark = pytest.mark.django_db


@pytest.fixture
def trip(route, bus):
    return make_trip(route, bus, local_datetime(4, 20, 30))


def place(name: str, latitude: str, longitude: str) -> None:
    Stop.objects.filter(name=name).update(latitude=Decimal(latitude), longitude=Decimal(longitude))


@pytest.fixture
def mapped_route(route):
    """Real Sri Lankan coordinates for the Colombo – Batticaloa road."""
    place("Colombo", "6.933600", "79.850000")
    place("Kadawatha", "7.000000", "79.950000")
    place("Kurunegala", "7.486300", "80.362500")
    place("Dambulla", "7.856000", "80.651800")
    place("Batticaloa", "7.710200", "81.694700")
    return route


class TestTheTripCarriesItsStopsCoordinates:
    def test_every_stop_has_its_position(self, api_client, trip, mapped_route):
        body = api_client.get(f"/api/v1/trips/{trip.pk}/").json()

        first = body["stops"][0]["stop"]
        assert (first["name"], first["latitude"], first["longitude"]) == (
            "Colombo",
            "6.933600",
            "79.850000",
        )
        assert all(stop["stop"]["latitude"] for stop in body["stops"])

    def test_stops_arrive_in_travel_order(self, api_client, trip, mapped_route):
        body = api_client.get(f"/api/v1/trips/{trip.pk}/").json()

        sequences = [stop["sequence"] for stop in body["stops"]]
        names = [stop["stop"]["name"] for stop in body["stops"]]
        assert sequences == sorted(sequences)
        assert (names[0], names[-1]) == ("Colombo", "Batticaloa")

    def test_a_stop_nobody_has_mapped_yet_reports_null(self, api_client, trip, mapped_route):
        Stop.objects.filter(name="Dambulla").update(latitude=None, longitude=None)

        body = api_client.get(f"/api/v1/trips/{trip.pk}/").json()

        unmapped = next(s for s in body["stops"] if s["stop"]["name"] == "Dambulla")
        assert unmapped["stop"]["latitude"] is None
        assert unmapped["stop"]["longitude"] is None

    def test_the_boarding_and_dropoff_pickers_carry_them_too(self, api_client, trip, mapped_route):
        body = api_client.get(f"/api/v1/trips/{trip.pk}/stops/").json()

        assert body["boarding_points"][0]["stop"]["latitude"]
        assert body["dropoff_points"][-1]["stop"]["longitude"]
        assert [point["sequence"] for point in body["boarding_points"]] == sorted(
            point["sequence"] for point in body["boarding_points"]
        )


class TestTheRouteCarriesThemForTheAdminMap:
    def test_the_public_route_detail_maps_the_whole_line(self, api_client, mapped_route):
        body = api_client.get(f"/api/v1/routes/{mapped_route.pk}/").json()

        assert [stop["stop"]["name"] for stop in body["stops"]] == [
            "Colombo",
            "Kadawatha",
            "Kurunegala",
            "Dambulla",
            "Batticaloa",
        ]
        assert body["origin"]["latitude"] == "6.933600"
        assert all(stop["stop"]["longitude"] for stop in body["stops"])

    def test_the_admin_route_detail_maps_it_as_well(self, admin_api, mapped_route):
        body = admin_api.get(f"/api/v1/admin/routes/{mapped_route.pk}/").json()

        stops = body["stops"]
        assert [stop["sequence"] for stop in stops] == [1, 2, 3, 4, 5]
        assert stops[0]["stop"]["latitude"] == "6.933600"
        assert stops[-1]["stop"]["name"] == "Batticaloa"

    def test_an_admin_can_save_and_read_back_a_position(self, admin_api):
        created = admin_api.post(
            "/api/v1/admin/stops/",
            {"name": "Habarana", "city": "Habarana", "latitude": "8.0370", "longitude": "80.7540"},
            format="json",
        )

        assert created.status_code == 201, created.content
        body = created.json()
        assert (body["latitude"], body["longitude"]) == ("8.037000", "80.754000")

    @pytest.mark.parametrize(
        "coordinates",
        [
            {"latitude": "95.0", "longitude": "80.0"},
            {"latitude": "7.0", "longitude": "200.0"},
            {"latitude": "7.0"},
        ],
        ids=["latitude-out-of-range", "longitude-out-of-range", "only-one-of-the-pair"],
    )
    def test_impossible_positions_are_refused(self, admin_api, coordinates):
        response = admin_api.post(
            "/api/v1/admin/stops/",
            {"name": "Nowhere", "city": "Nowhere", **coordinates},
            format="json",
        )

        assert response.status_code == 400
        assert not Stop.objects.filter(name="Nowhere").exists()
