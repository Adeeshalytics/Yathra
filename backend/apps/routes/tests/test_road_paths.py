"""
The road a bus drives.

Straight lines between stops are a sketch, not a route: buses follow roads. The backend asks a
routing service for the real geometry once, stores it on the route, and serves it to every map.
These tests pin down when it is fetched, when it is thrown away, and what happens when the
service is not there — which must never be "the booking flow breaks".
"""

from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings
from django.utils import timezone

from apps.core.tests.factories import create_route_with_stops
from apps.routes import routing
from apps.routes.models import Route, Stop
from apps.routes.services import (
    clear_paths_through_stop,
    refresh_route_path,
    route_coordinates,
)
from apps.trips.tests.conftest import BATTICALOA_PLAN

pytestmark = pytest.mark.django_db

# A short encoded polyline (the reference vector for this encoding).
GEOMETRY = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
SERVICE = {"URL": "https://routing.test", "PROFILE": "driving", "TIMEOUT_SECONDS": 1.0}


def a_road(**overrides) -> routing.RoadPath:
    return routing.RoadPath(
        **{
            "geometry": GEOMETRY,
            "distance_m": 116_000,
            "duration_s": 8_160,
            "source": "routing.test",
            **overrides,
        }
    )


@pytest.fixture
def route(db) -> Route:
    return create_route_with_stops("Colombo – Batticaloa", BATTICALOA_PLAN)


class TestAskingForTheRoad:
    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_it_stores_the_geometry_and_what_it_measured(self, route):
        with patch("apps.routes.routing.road_path", return_value=a_road()) as service:
            assert refresh_route_path(route) is True

        route.refresh_from_db()
        assert route.path == GEOMETRY
        assert route.path_distance_m == 116_000
        assert route.path_duration_s == 8_160
        assert route.path_source == "routing.test"
        assert route.path_updated_at is not None
        # Coordinates go in travel order, latitude first — the service flips them itself.
        (coordinates,) = service.call_args.args
        assert len(coordinates) == len(BATTICALOA_PLAN)
        assert coordinates == route_coordinates(route)

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_a_service_that_is_down_leaves_the_route_alone(self, route):
        with patch(
            "apps.routes.routing.road_path",
            side_effect=routing.RoutingUnavailable("connection refused"),
        ):
            assert refresh_route_path(route) is False

        route.refresh_from_db()
        assert route.path == ""

    def test_nothing_is_asked_when_no_service_is_configured(self, route):
        with patch("apps.routes.routing.road_path") as service:
            assert refresh_route_path(route) is False

        service.assert_not_called()

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_a_route_with_one_mapped_stop_has_no_road(self, route):
        Stop.objects.filter(route_stops__route=route).exclude(pk=route.origin_id).update(
            latitude=None, longitude=None
        )

        with patch("apps.routes.routing.road_path") as service:
            assert refresh_route_path(route) is False

        service.assert_not_called()

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_unmapped_stops_are_left_out_of_the_request(self, route):
        middle = route.route_stops.order_by("sequence")[1].stop
        Stop.objects.filter(pk=middle.pk).update(latitude=None, longitude=None)

        with patch("apps.routes.routing.road_path", return_value=a_road()) as service:
            refresh_route_path(route)

        (coordinates,) = service.call_args.args
        assert len(coordinates) == len(BATTICALOA_PLAN) - 1


class TestThrowingTheRoadAway:
    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_reordering_the_stops_drops_the_stored_road(self, admin_api, route):
        with patch("apps.routes.routing.road_path", return_value=a_road()):
            refresh_route_path(route)
        assert Route.objects.get(pk=route.pk).path

        stops = [
            {
                "stop": str(entry.stop_id),
                "arrival_offset_minutes": int(entry.arrival_offset.total_seconds() // 60),
                "departure_offset_minutes": int(entry.departure_offset.total_seconds() // 60),
                "is_boarding_point": entry.is_boarding_point,
                "is_dropoff_point": entry.is_dropoff_point,
            }
            for entry in route.route_stops.order_by("sequence")
        ]
        dropped = stops[:2] + stops[3:]  # remove a stop from the middle
        with patch("apps.routes.routing.road_path", side_effect=routing.RoutingUnavailable("no")):
            response = admin_api.patch(
                f"/api/v1/admin/routes/{route.pk}/", {"stops": dropped}, format="json"
            )

        assert response.status_code == 200, response.content
        # The old geometry belonged to the old stops, so it is gone rather than misleading.
        assert Route.objects.get(pk=route.pk).path == ""

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_moving_a_stop_drops_every_road_through_it(self, admin_api, route):
        with patch("apps.routes.routing.road_path", return_value=a_road()):
            refresh_route_path(route)
        moved = route.route_stops.order_by("sequence")[1].stop

        response = admin_api.patch(
            f"/api/v1/admin/stops/{moved.pk}/",
            {"latitude": "7.123456", "longitude": "80.123456"},
            format="json",
        )

        assert response.status_code == 200, response.content
        assert Route.objects.get(pk=route.pk).path == ""

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_renaming_a_stop_keeps_the_road(self, admin_api, route):
        with patch("apps.routes.routing.road_path", return_value=a_road()):
            refresh_route_path(route)
        stop = route.route_stops.order_by("sequence")[1].stop

        response = admin_api.patch(
            f"/api/v1/admin/stops/{stop.pk}/", {"name": f"{stop.name} Bus Stand"}, format="json"
        )

        assert response.status_code == 200, response.content
        assert Route.objects.get(pk=route.pk).path == GEOMETRY

    def test_clearing_by_stop_only_touches_routes_that_use_it(self, route):
        # A route with no stop in common, so clearing one cannot affect the other.
        elsewhere = (("Galle", 0, 0), ("Matara", 90, 90))
        other = create_route_with_stops("Galle – Matara", elsewhere)
        Route.objects.update(path=GEOMETRY, path_distance_m=1)
        unused = Stop.objects.create(name="Ella", city="Ella", latitude=6.8, longitude=81.0)

        assert clear_paths_through_stop(unused) == 0
        assert Route.objects.exclude(path="").count() == 2

        assert clear_paths_through_stop(route.origin) == 1
        assert Route.objects.get(pk=route.pk).path == ""
        assert Route.objects.get(pk=other.pk).path == GEOMETRY  # untouched


class TestTheApiPublishesTheRoad:
    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_a_trip_carries_the_road_its_route_drives(self, api_client, route):
        from apps.core.tests.factories import create_bookable_bus
        from apps.trips.services import create_trip, route_timetable, timings_from_route
        from apps.trips.tests.conftest import local_datetime

        departure = local_datetime(3, 20, 30)
        trip = create_trip(
            route=route,
            bus=create_bookable_bus(),
            departure_datetime=departure,
            base_price=route.base_fare or 1000,
            timings=timings_from_route(route_timetable(route), departure),
        )
        with patch("apps.routes.routing.road_path", return_value=a_road()):
            refresh_route_path(route)

        body = api_client.get(f"/api/v1/trips/{trip.pk}/").json()

        assert body["route"]["road_path"]["geometry"] == GEOMETRY
        assert body["route"]["road_path"]["precision"] == routing.POLYLINE_PRECISION
        assert body["route"]["road_path"]["distance_m"] == 116_000
        # Every stop carries a position, which is what the markers are drawn from.
        assert all(stop["stop"]["latitude"] for stop in body["stops"])

    def test_a_route_with_no_road_says_so_rather_than_guessing(self, api_client, route):
        from apps.core.tests.factories import create_bookable_bus
        from apps.trips.services import create_trip, route_timetable, timings_from_route
        from apps.trips.tests.conftest import local_datetime

        departure = local_datetime(3, 20, 30)
        trip = create_trip(
            route=route,
            bus=create_bookable_bus(),
            departure_datetime=departure,
            base_price=route.base_fare or 1000,
            timings=timings_from_route(route_timetable(route), departure),
        )

        body = api_client.get(f"/api/v1/trips/{trip.pk}/").json()

        assert body["route"]["road_path"] is None

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_an_administrator_sees_it_on_the_route(self, admin_api, route):
        with patch("apps.routes.routing.road_path", return_value=a_road()):
            refresh_route_path(route)

        body = admin_api.get(f"/api/v1/admin/routes/{route.pk}/").json()

        assert body["road_path"]["geometry"] == GEOMETRY
        assert body["road_path"]["source"] == "routing.test"


class TestTheBackfillCommand:
    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_it_fills_in_the_routes_that_have_no_road(self, route):
        done = create_route_with_stops("Kandy – Nuwara Eliya", BATTICALOA_PLAN[:3])
        Route.objects.filter(pk=done.pk).update(path=GEOMETRY, path_updated_at=timezone.now())

        with patch("apps.routes.routing.road_path", return_value=a_road()) as service:
            call_command("refresh_route_paths")

        assert service.call_count == 1  # only the route that was missing one
        assert Route.objects.get(pk=route.pk).path == GEOMETRY

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_force_refetches_everything(self, route):
        create_route_with_stops("Kandy – Nuwara Eliya", BATTICALOA_PLAN[:3])
        Route.objects.update(path=GEOMETRY)

        with patch("apps.routes.routing.road_path", return_value=a_road()) as service:
            call_command("refresh_route_paths", "--force")

        assert service.call_count == 2

    def test_it_refuses_to_run_with_no_service_configured(self, route):
        with pytest.raises(CommandError, match="ROUTING_SERVICE_URL"):
            call_command("refresh_route_paths")


class TestTheRoutingClient:
    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_it_asks_for_longitude_first(self):
        payload = b'{"code":"Ok","routes":[{"geometry":"abc","distance":10.4,"duration":60.2}]}'

        with patch("apps.routes.routing.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = payload
            path = routing.road_path([(6.9336, 79.85), (7.2919, 80.6305)])

        url = urlopen.call_args.args[0].full_url
        # OSRM takes lon,lat — the other way round routes you into the sea.
        assert "79.850000,6.933600;80.630500,7.291900" in url
        assert "overview=full" in url and "geometries=polyline" in url
        assert path.geometry == "abc"
        assert (path.distance_m, path.duration_s) == (10, 60)

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_a_service_that_cannot_find_a_road_is_unavailable(self):
        with patch("apps.routes.routing.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b'{"code":"NoRoute"}'
            with pytest.raises(routing.RoutingUnavailable, match="NoRoute"):
                routing.road_path([(6.9, 79.8), (7.2, 80.6)])

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_rubbish_from_the_service_is_unavailable_not_a_crash(self):
        with patch("apps.routes.routing.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b"<html>502</html>"
            with pytest.raises(routing.RoutingUnavailable):
                routing.road_path([(6.9, 79.8), (7.2, 80.6)])

    @override_settings(ROUTING_SERVICE=SERVICE)
    def test_one_point_is_not_a_route(self):
        with pytest.raises(routing.RoutingUnavailable):
            routing.road_path([(6.9, 79.8)])
