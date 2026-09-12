from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.core.tests.factories import (
    AdminFactory,
    CustomerFactory,
    create_bookable_bus,
    create_route_with_stops,
)
from apps.trips.services import create_trip, route_timetable, timings_from_route
from apps.trips.tests.conftest import BATTICALOA_PLAN, local_datetime

LOCKS = "/api/v1/seat-locks/"
BOOKINGS = "/api/v1/bookings/"


def make_trip(route, bus, departure, price=None):
    return create_trip(
        route=route,
        bus=bus,
        departure_datetime=departure,
        base_price=price or route.base_fare,
        timings=timings_from_route(route_timetable(route), departure),
    )


def build_trip(days_ahead: int = 4):
    """A Colombo → Batticaloa trip on a 41-seat bus, created without fixtures."""
    route = create_route_with_stops(
        "Colombo – Batticaloa", BATTICALOA_PLAN, base_fare=Decimal("2500.00")
    )
    return make_trip(route, create_bookable_bus(), local_datetime(days_ahead, 20, 30))


def client_for(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def lock(client, trip, *seats):
    return client.post(LOCKS, {"trip": str(trip.pk), "seats": list(seats)}, format="json")


def passenger(seat: str, name: str = "Kasuni Fernando") -> dict:
    return {
        "seat_number": seat,
        "name": name,
        "phone": "077 123 4567",
        "email": f"seat{seat}@example.com",
    }


def stop_id(trip, name: str) -> str:
    return str(trip.trip_stops.get(stop__name=name).stop_id)


def booking_payload(trip, *seats, boarding="Colombo", dropoff="Batticaloa", passengers=None):
    return {
        "trip": str(trip.pk),
        "boarding_stop": stop_id(trip, boarding),
        "dropoff_stop": stop_id(trip, dropoff),
        "passengers": passengers if passengers is not None else [passenger(s) for s in seats],
    }


def hold_and_book(client, trip, *seats, **kwargs):
    assert lock(client, trip, *seats).status_code == 201
    return client.post(BOOKINGS, booking_payload(trip, *seats, **kwargs), format="json")


def seat_status(client, trip, number: str) -> str:
    body = client.get(f"/api/v1/trips/{trip.pk}/seats/").json()
    return next(seat["status"] for seat in body["seats"] if seat["seat_number"] == number)


@pytest.fixture
def route(db):
    return create_route_with_stops(
        "Colombo – Batticaloa", BATTICALOA_PLAN, base_fare=Decimal("2500.00")
    )


@pytest.fixture
def bus(db):
    return create_bookable_bus(registration_number="WP NC-4521")


@pytest.fixture
def trip(route, bus):
    return make_trip(route, bus, local_datetime(4, 20, 30))


@pytest.fixture
def alice(db):
    return CustomerFactory(name="Alice Perera")


@pytest.fixture
def bob(db):
    return CustomerFactory(name="Bob Silva")


@pytest.fixture
def staff(db):
    return AdminFactory()
