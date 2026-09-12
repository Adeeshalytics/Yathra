from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.core.tests.factories import RouteFactory, StopFactory, TripFactory
from apps.routes.models import RouteStop
from apps.trips.models import TripStatus

pytestmark = pytest.mark.django_db


def test_stops_are_public_and_exclude_inactive(api_client):
    StopFactory(name="Kandy", city="Kandy")
    StopFactory(name="Closed Stand", city="Kandy", active=False)

    response = api_client.get("/api/v1/stops/")

    assert response.status_code == 200
    assert [s["name"] for s in response.json()["results"]] == ["Kandy"]


def test_stops_can_be_searched(api_client):
    StopFactory(name="Galle", city="Galle")
    StopFactory(name="Jaffna", city="Jaffna")

    response = api_client.get("/api/v1/stops/", {"search": "gal"})

    assert [s["name"] for s in response.json()["results"]] == ["Galle"]


def test_routes_list_includes_duration_and_lowest_upcoming_fare(api_client):
    route = RouteFactory(name="Colombo – Kandy")
    RouteStop.objects.create(route=route, stop=route.origin, sequence=1)
    RouteStop.objects.create(
        route=route,
        stop=route.destination,
        sequence=2,
        arrival_offset=timedelta(hours=3, minutes=30),
        departure_offset=timedelta(hours=3, minutes=30),
    )
    TripFactory(route=route, base_price=Decimal("900.00"))
    TripFactory(route=route, base_price=Decimal("750.00"))
    TripFactory(route=route, base_price=Decimal("100.00"), status=TripStatus.CANCELLED)
    TripFactory(
        route=route,
        base_price=Decimal("50.00"),
        departure_datetime=timezone.now() - timedelta(days=1),
    )

    response = api_client.get("/api/v1/routes/")

    assert response.status_code == 200
    [item] = response.json()["results"]
    assert item["duration_minutes"] == 210
    assert item["stop_count"] == 2
    assert item["starting_fare"] == "750.00"


def test_route_detail_lists_stops_in_order(api_client):
    route = RouteFactory()
    middle = StopFactory()
    RouteStop.objects.create(route=route, stop=route.destination, sequence=3)
    RouteStop.objects.create(route=route, stop=route.origin, sequence=1)
    RouteStop.objects.create(route=route, stop=middle, sequence=2)

    response = api_client.get(f"/api/v1/routes/{route.id}/")

    assert response.status_code == 200
    assert [s["stop"]["id"] for s in response.json()["stops"]] == [
        str(route.origin.id),
        str(middle.id),
        str(route.destination.id),
    ]
