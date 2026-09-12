from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.bookings.models import BookingStatus, Passenger
from apps.core.tests.factories import BookingFactory, create_bookable_bus, create_route_with_stops
from apps.fleet.models import Bus
from apps.operators.models import Operator, OperatorStatus
from apps.routes.models import Stop
from apps.trips.models import Trip
from apps.trips.services import create_trip, route_timetable, timings_from_route

from .conftest import local_datetime

pytestmark = pytest.mark.django_db

URL = "/api/v1/trips/search/"


def day(offset: int) -> str:
    return (timezone.localdate() + timedelta(days=offset)).isoformat()


def clock(value: str) -> str:
    return timezone.localtime(parse_datetime(value)).strftime("%H:%M")


def make_trip(route, bus, departure, *, price=None, **changes) -> Trip:
    trip = create_trip(
        route=route,
        bus=bus,
        departure_datetime=departure,
        base_price=price or route.base_fare,
        timings=timings_from_route(route_timetable(route), departure),
    )
    if changes:
        Trip.objects.filter(pk=trip.pk).update(**changes)
    return trip


def book(trip, seats: int, status=BookingStatus.CONFIRMED):
    booking = BookingFactory(trip=trip, status=status)
    holds = status not in (BookingStatus.CANCELLED, BookingStatus.EXPIRED)
    Passenger.objects.bulk_create(
        Passenger(booking=booking, trip=trip, name=f"P{n}", seat_number=str(n), holds_seat=holds)
        for n in range(1, seats + 1)
    )


def search(client, **params):
    params = {"from": "Colombo", "to": "Batticaloa", "date": day(4), **params}
    return client.get(URL, params)


def codes(response):
    assert response.status_code == 200, response.content
    return [trip["code"] for trip in response.json()["results"]]


@pytest.fixture
def night_trip(route, bus):
    return make_trip(route, bus, local_datetime(4, 20, 30))


class TestMatching:
    def test_finds_the_trip_and_describes_the_journey(self, api_client, night_trip):
        body = search(api_client, passengers=2).json()

        assert body["count"] == 1
        [trip] = body["results"]
        assert trip["code"] == night_trip.code
        assert trip["route"]["name"] == "Colombo – Batticaloa"
        assert trip["operator"]["name"] == night_trip.operator.company_name
        assert trip["bus"]["registration_number"] == "WP NC-4521"
        assert (clock(trip["boarding"]["time"]), clock(trip["dropoff"]["time"])) == (
            "20:30",
            "05:30",
        )
        assert trip["duration_minutes"] == 540
        assert (trip["price"], trip["currency"]) == ("2500.00", "LKR")
        assert trip["available_seats"] == 41
        assert [p["stop"]["name"] for p in trip["boarding_points"]] == [
            "Colombo",
            "Kadawatha",
            "Kurunegala",
            "Dambulla",
        ]
        assert [p["stop"]["name"] for p in trip["dropoff_points"]] == [
            "Kadawatha",
            "Kurunegala",
            "Dambulla",
            "Batticaloa",
        ]
        assert body["search"]["from"] == {"city": "Colombo", "label": "Colombo", "stop_id": None}
        assert body["route_exists"] is True

    def test_accepts_stop_ids_from_the_location_pickers(self, api_client, night_trip):
        colombo = Stop.objects.get(name="Colombo")

        body = search(api_client, **{"from": str(colombo.id)}).json()

        assert body["count"] == 1
        assert body["search"]["from"]["stop_id"] == str(colombo.id)

    def test_matches_part_of_a_route(self, api_client, night_trip):
        body = search(api_client, **{"from": "Kurunegala", "to": "Dambulla"}).json()

        [trip] = body["results"]
        assert (clock(trip["boarding"]["time"]), clock(trip["dropoff"]["time"])) == (
            "22:35",
            "00:30",
        )
        assert trip["duration_minutes"] == 115

    def test_the_travel_date_is_the_boarding_date(self, api_client, night_trip):
        # The bus leaves Colombo on day 4 but reaches Dambulla after midnight.
        on_boarding_day = search(api_client, **{"from": "Dambulla", "date": day(5)})
        on_departure_day = search(api_client, **{"from": "Dambulla", "date": day(4)})

        assert codes(on_boarding_day) == [night_trip.code]
        assert codes(on_departure_day) == []

    def test_buses_only_run_one_way(self, api_client, night_trip):
        body = search(api_client, **{"from": "Batticaloa", "to": "Colombo"}).json()

        assert body["count"] == 0
        assert body["route_exists"] is False
        assert body["nearest_available_date"] is None

    def test_suggests_the_nearest_day_with_buses(self, api_client, night_trip):
        later = search(api_client, date=day(3)).json()
        earlier = search(api_client, date=day(6)).json()

        assert (later["count"], later["route_exists"]) == (0, True)
        assert later["nearest_available_date"] == day(4)
        assert earlier["nearest_available_date"] == day(4)

    def test_stops_the_bus_has_already_passed_cannot_be_boarded(self, api_client, route, bus):
        departed = timezone.now() - timedelta(hours=1)  # Kurunegala is still 60 minutes away
        trip = make_trip(route, bus, departed)
        kurunegala = timezone.localdate(departed + timedelta(minutes=125))

        from_colombo = search(api_client, date=timezone.localdate().isoformat())
        from_kurunegala = search(api_client, **{"from": "Kurunegala", "date": kurunegala})

        assert trip.code not in codes(from_colombo)
        assert codes(from_kurunegala) == [trip.code]
        [result] = from_kurunegala.json()["results"]
        assert [p["stop"]["name"] for p in result["boarding_points"]] == ["Kurunegala", "Dambulla"]

    @pytest.mark.parametrize(
        "hide",
        [
            lambda trip: Trip.objects.filter(pk=trip.pk).update(status="cancelled"),
            lambda trip: Trip.objects.filter(pk=trip.pk).update(status="boarding"),
            lambda trip: Trip.objects.filter(pk=trip.pk).update(active=False),
            lambda trip: Bus.objects.filter(pk=trip.bus_id).update(active=False),
            lambda trip: Operator.objects.filter(pk=trip.operator_id).update(
                status=OperatorStatus.SUSPENDED
            ),
        ],
        ids=["cancelled", "boarding", "off-sale", "bus-inactive", "operator-suspended"],
    )
    def test_only_trips_on_sale_are_found(self, api_client, night_trip, hide):
        hide(night_trip)

        assert codes(search(api_client)) == []

    def test_closed_stops_are_not_offered(self, api_client, night_trip):
        Stop.objects.filter(name="Dambulla").update(active=False)

        [trip] = search(api_client, **{"from": "Kurunegala"}).json()["results"]

        assert "Dambulla" not in [p["stop"]["name"] for p in trip["boarding_points"]]
        assert "Dambulla" not in [p["stop"]["name"] for p in trip["dropoff_points"]]
        assert search(api_client, **{"to": "Dambulla"}).status_code == 400

    def test_needs_enough_free_seats_for_everyone(self, api_client, night_trip):
        book(night_trip, 40)
        book(night_trip, 1, status=BookingStatus.CANCELLED)

        assert codes(search(api_client, passengers=1)) == [night_trip.code]
        assert codes(search(api_client, passengers=2)) == []
        assert search(api_client).json()["results"][0]["available_seats"] == 1


class TestValidation:
    @pytest.mark.parametrize(
        ("params", "field"),
        [
            ({"from": ""}, "from"),
            ({"to": "Atlantis"}, "to"),
            ({"to": "colombo"}, "to"),
            ({"date": "15/09/2026"}, "date"),
            ({"date": day(-1)}, "date"),
            ({"date": day(400)}, "date"),
            ({"passengers": 0}, "passengers"),
            ({"passengers": 11}, "passengers"),
            ({"sort": "cheapest"}, "sort"),
            ({"bus_type": "luxury,limousine"}, "bus_type"),
            ({"departure": "midnight"}, "departure"),
            ({"operator": "not-an-id"}, "operator"),
            ({"min_price": "3000", "max_price": "1000"}, "max_price"),
            ({"min_price": "-5"}, "min_price"),
        ],
    )
    def test_rejects_bad_searches(self, api_client, route, params, field):
        response = search(api_client, **params)

        assert response.status_code == 400
        assert field in response.json()["error"]["details"]

    def test_is_public(self, api_client, route):
        assert search(api_client).status_code == 200


@pytest.fixture
def three_buses(route):
    """Three Colombo → Batticaloa departures on day 4 with different buses and prices."""
    express = create_route_with_stops(
        "Colombo – Batticaloa Express", (("Colombo", 0, 0), ("Batticaloa", 420, 420))
    )
    luxury = make_trip(
        route,
        create_bookable_bus(bus_type="super_luxury", facilities=["ac", "wifi"]),
        local_datetime(4, 20, 30),
        price=Decimal("2500"),
    )
    normal = make_trip(
        route,
        create_bookable_bus(bus_type="normal", facilities=[]),
        local_datetime(4, 7, 0),
        price=Decimal("1200"),
    )
    fast = make_trip(
        express,
        create_bookable_bus(bus_type="luxury", facilities=["ac"]),
        local_datetime(4, 13, 0),
        price=Decimal("1800"),
    )
    return {"luxury": luxury, "normal": normal, "fast": fast}


class TestSortingFilteringAndFacets:
    @pytest.mark.parametrize(
        ("sort", "order"),
        [
            ("departure", ["normal", "fast", "luxury"]),
            ("-departure", ["luxury", "fast", "normal"]),
            ("price", ["normal", "fast", "luxury"]),
            ("-price", ["luxury", "fast", "normal"]),
            ("duration", ["fast", "normal", "luxury"]),
            ("seats", ["fast", "luxury", "normal"]),
        ],
    )
    def test_sorting(self, api_client, three_buses, sort, order):
        book(three_buses["normal"], 5)

        assert codes(search(api_client, sort=sort)) == [three_buses[key].code for key in order]

    @pytest.mark.parametrize(
        ("filters", "expected"),
        [
            ({"bus_type": "normal"}, ["normal"]),
            ({"bus_type": "luxury,super_luxury"}, ["fast", "luxury"]),
            ({"ac": "true"}, ["fast", "luxury"]),
            ({"ac": "false"}, ["normal"]),
            ({"min_price": "1500"}, ["fast", "luxury"]),
            ({"max_price": "2000"}, ["normal", "fast"]),
            ({"min_price": "1500", "max_price": "2000"}, ["fast"]),
            ({"departure": "morning"}, ["normal"]),
            ({"departure": "afternoon,evening"}, ["fast", "luxury"]),
            ({"departure": "early_morning"}, []),
        ],
    )
    def test_filters(self, api_client, three_buses, filters, expected):
        assert codes(search(api_client, **filters)) == [three_buses[key].code for key in expected]

    def test_operator_filter(self, api_client, three_buses):
        operator = three_buses["luxury"].operator_id

        assert codes(search(api_client, operator=str(operator))) == [three_buses["luxury"].code]

    def test_facets_count_every_option_ignoring_the_filters(self, api_client, three_buses):
        body = search(api_client, bus_type="normal").json()
        facets = body["facets"]

        assert (body["count"], facets["total"]) == (1, 3)
        assert {item["value"]: item["count"] for item in facets["bus_types"]} == {
            "normal": 1,
            "ac": 0,
            "luxury": 1,
            "super_luxury": 1,
        }
        assert {item["value"]: item["count"] for item in facets["departure_periods"]} == {
            "early_morning": 0,
            "morning": 1,
            "afternoon": 1,
            "evening": 1,
        }
        assert facets["ac"] == {"ac": 2, "non_ac": 1}
        assert facets["price"] == {"min": "1200.00", "max": "2500.00"}
        assert sorted(item["count"] for item in facets["operators"]) == [1, 1, 1]

    def test_pagination(self, api_client, three_buses):
        body = search(api_client, page_size=2).json()
        second = search(api_client, page_size=2, page=2).json()

        assert (body["count"], body["total_pages"], len(body["results"])) == (3, 2, 2)
        assert len(second["results"]) == 1
