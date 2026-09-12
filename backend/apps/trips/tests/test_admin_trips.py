from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.models import ActivityLog
from apps.bookings.models import BookingStatus, Passenger
from apps.core.tests.factories import (
    BookingFactory,
    BusFactory,
    OperatorFactory,
    TripFactory,
    create_bookable_bus,
    create_route_with_stops,
)
from apps.operators.models import OperatorStatus
from apps.trips.models import Trip, TripStatus

from .conftest import BATTICALOA_PLAN, iso, local_datetime

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/trips/"


def payload(route, bus, departure, **overrides):
    return {
        "route": str(route.id),
        "bus": str(bus.id),
        "departure_datetime": iso(departure),
        **overrides,
    }


def create(admin_api, route, bus, departure, **overrides):
    response = admin_api.post(URL, payload(route, bus, departure, **overrides), format="json")
    assert response.status_code == 201, response.content
    return response.json()


def local_times(stops, key):
    return [timezone.localtime(_parse(s[key])).strftime("%H:%M") for s in stops]


def _parse(value):
    from django.utils.dateparse import parse_datetime

    return parse_datetime(value)


class TestCreate:
    def test_builds_the_stop_timetable_from_the_route(self, admin_api, route, bus):
        departure = local_datetime(4, 20, 30)

        body = create(admin_api, route, bus, departure)

        assert body["code"].startswith("TR")
        assert body["operator"] == str(bus.operator_id)
        assert body["operator_name"] == bus.operator.company_name
        assert body["base_price"] == "2500.00"  # the route's standard fare
        assert body["status"] == TripStatus.SCHEDULED
        assert body["active"] is True
        assert local_times(body["stops"], "arrival_datetime") == [
            "20:30",
            "21:00",
            "22:30",
            "00:30",
            "05:30",
        ]
        assert local_times(body["stops"], "departure_datetime")[2] == "22:35"
        assert _parse(body["estimated_arrival_datetime"]) == departure + timedelta(hours=9)
        assert (body["available_seats"], body["booking_count"]) == (41, 0)
        assert body["bus_summary"]["registration_number"] == "WP NC-4521"
        assert ActivityLog.objects.filter(entity_type="trip", action="created").exists()

    def test_explicit_price_and_off_sale(self, admin_api, route, bus):
        body = create(
            admin_api, route, bus, local_datetime(3, 8), base_price="1999.50", active=False
        )

        assert (body["base_price"], body["active"]) == ("1999.50", False)

    def test_route_without_a_fare_needs_a_price(self, admin_api, bus):
        route = create_route_with_stops("No Fare", (("A", 0, 0), ("B", 60, 60)))

        response = admin_api.post(URL, payload(route, bus, local_datetime(2, 9)), format="json")

        assert response.status_code == 400
        assert "base_price" in response.json()["error"]["details"]

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [({"base_price": "-1"}, "base_price"), ({"base_price": "100001"}, "base_price")],
    )
    def test_invalid_prices(self, admin_api, route, bus, overrides, field):
        response = admin_api.post(
            URL, payload(route, bus, local_datetime(2, 9), **overrides), format="json"
        )
        assert response.status_code == 400
        assert field in response.json()["error"]["details"]

    def test_departure_must_be_in_the_future(self, admin_api, route, bus):
        response = admin_api.post(URL, payload(route, bus, local_datetime(-1, 9)), format="json")

        assert response.status_code == 400
        assert "departure_datetime" in response.json()["error"]["details"]

    @pytest.mark.parametrize(
        "make_bus",
        [
            lambda: create_bookable_bus(active=False),
            lambda: BusFactory(seat_layout=None),
            lambda: create_bookable_bus(operator=OperatorFactory(status=OperatorStatus.SUSPENDED)),
            lambda: create_bookable_bus(operator=OperatorFactory(status=OperatorStatus.PENDING)),
        ],
        ids=["inactive", "no-layout", "suspended-operator", "pending-operator"],
    )
    def test_bus_must_be_ready_to_run(self, admin_api, route, make_bus):
        response = admin_api.post(
            URL, payload(route, make_bus(), local_datetime(2, 9)), format="json"
        )

        assert response.status_code == 400
        assert "bus" in response.json()["error"]["details"]

    def test_route_must_be_active(self, admin_api, route, bus):
        route.active = False
        route.save()

        response = admin_api.post(URL, payload(route, bus, local_datetime(2, 9)), format="json")

        assert response.status_code == 400
        assert "route" in response.json()["error"]["details"]


class TestBusAvailability:
    def test_a_bus_cannot_run_overlapping_trips(self, admin_api, route, bus):
        first = create(admin_api, route, bus, local_datetime(4, 20, 30))  # until 05:30 next day

        clash = admin_api.post(URL, payload(route, bus, local_datetime(5, 3)), format="json")
        after = admin_api.post(URL, payload(route, bus, local_datetime(5, 6)), format="json")

        assert clash.status_code == 400
        assert first["code"] in clash.json()["error"]["details"]["bus"][0]
        assert after.status_code == 201

    def test_the_database_rejects_overlaps_on_every_code_path(self, route, bus):
        departure = local_datetime(3, 10)
        TripFactory(route=route, bus=bus, departure_datetime=departure)

        with pytest.raises(IntegrityError), transaction.atomic():
            TripFactory(route=route, bus=bus, departure_datetime=departure + timedelta(hours=1))

    def test_cancelling_a_trip_frees_the_bus(self, admin_api, route, bus):
        first = create(admin_api, route, bus, local_datetime(4, 20, 30))
        admin_api.post(f"{URL}{first['id']}/cancel/", {"reason": "Breakdown"}, format="json")

        response = admin_api.post(URL, payload(route, bus, local_datetime(4, 22)), format="json")

        assert response.status_code == 201


class TestStopTimings:
    def _stops(self, departure, minutes):
        return [
            {
                "sequence": index,
                "arrival_datetime": iso(departure + timedelta(minutes=arrive)),
                "departure_datetime": iso(departure + timedelta(minutes=leave)),
            }
            for index, (arrive, leave) in enumerate(minutes, start=1)
        ]

    def test_custom_timings_are_saved(self, admin_api, route, bus):
        departure = local_datetime(4, 20, 30)
        stops = self._stops(departure, [(0, 0), (30, 35), (130, 135), (255, 265), (560, 560)])

        body = create(admin_api, route, bus, departure, stops=stops)

        assert local_times(body["stops"], "arrival_datetime") == [
            "20:30",
            "21:00",
            "22:40",
            "00:45",
            "05:50",
        ]
        assert _parse(body["estimated_arrival_datetime"]) == departure + timedelta(minutes=560)

    @pytest.mark.parametrize(
        "minutes",
        [
            [(0, 0), (30, 35), (20, 25), (255, 265), (560, 560)],  # out of order
            [(0, 0), (30, 25), (130, 135), (255, 265), (560, 560)],  # leaves before arriving
            [(5, 5), (30, 35), (130, 135), (255, 265), (560, 560)],  # origin off departure
            [(0, 0), (30, 35), (130, 135), (255, 265)],  # a stop missing
        ],
        ids=["out-of-order", "departs-before-arrival", "origin-mismatch", "missing-stop"],
    )
    def test_impossible_timings_are_rejected(self, admin_api, route, bus, minutes):
        departure = local_datetime(4, 20, 30)
        response = admin_api.post(
            URL,
            payload(route, bus, departure, stops=self._stops(departure, minutes)),
            format="json",
        )

        assert response.status_code == 400
        assert "stops" in response.json()["error"]["details"]

    def test_moving_the_departure_shifts_every_stop(self, admin_api, route, bus):
        departure = local_datetime(4, 20, 30)
        stops = self._stops(departure, [(0, 0), (30, 35), (130, 135), (255, 265), (560, 560)])
        trip = create(admin_api, route, bus, departure, stops=stops)

        response = admin_api.patch(
            f"{URL}{trip['id']}/",
            {"departure_datetime": iso(departure + timedelta(hours=1))},
            format="json",
        )

        assert response.status_code == 200, response.content
        assert local_times(response.json()["stops"], "arrival_datetime") == [
            "21:30",
            "22:00",
            "23:40",
            "01:45",
            "06:50",
        ]
        log = ActivityLog.objects.get(action="updated")
        assert set(log.changes["fields"]) >= {"departure_datetime", "stops"}

    def test_changing_the_route_rebuilds_the_timetable(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(4, 8))
        short = create_route_with_stops(
            "Colombo – Kurunegala", BATTICALOA_PLAN[:3], base_fare=Decimal("900.00")
        )

        body = admin_api.patch(
            f"{URL}{trip['id']}/", {"route": str(short.id)}, format="json"
        ).json()

        assert [s["stop"]["name"] for s in body["stops"]] == ["Colombo", "Kadawatha", "Kurunegala"]
        assert body["base_price"] == "2500.00"  # the trip's own price isn't overwritten

    def test_reset_timings_restores_the_route_offsets(self, admin_api, route, bus):
        departure = local_datetime(4, 20, 30)
        stops = self._stops(departure, [(0, 0), (30, 35), (130, 135), (255, 265), (560, 560)])
        trip = create(admin_api, route, bus, departure, stops=stops)

        body = admin_api.post(f"{URL}{trip['id']}/reset-timings/").json()

        assert local_times(body["stops"], "arrival_datetime")[-1] == "05:30"


class TestLifecycle:
    def test_status_moves_forward_through_the_journey(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(2, 9))
        url = f"{URL}{trip['id']}/status/"

        for status in ("boarding", "departed", "completed"):
            response = admin_api.post(url, {"status": status}, format="json")
            assert response.status_code == 200
            assert response.json()["status"] == status

        backwards = admin_api.post(url, {"status": "boarding"}, format="json")
        assert backwards.status_code == 400
        assert ActivityLog.objects.filter(action="status_changed").count() == 3

    def test_a_scheduled_trip_cannot_jump_to_completed(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(2, 9))

        response = admin_api.post(
            f"{URL}{trip['id']}/status/", {"status": "completed"}, format="json"
        )

        assert response.status_code == 400

    def test_only_scheduled_trips_can_be_edited(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(2, 9))
        admin_api.post(f"{URL}{trip['id']}/status/", {"status": "boarding"}, format="json")

        response = admin_api.patch(f"{URL}{trip['id']}/", {"base_price": "10.00"}, format="json")

        assert response.status_code == 400

    def test_cancel(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(2, 9))

        body = admin_api.post(
            f"{URL}{trip['id']}/cancel/", {"reason": "Road closed at Habarana"}, format="json"
        ).json()

        assert (body["status"], body["active"]) == ("cancelled", False)
        assert body["cancellation_reason"] == "Road closed at Habarana"
        assert body["cancelled_at"]
        assert admin_api.post(f"{URL}{trip['id']}/activate/").status_code == 400
        assert admin_api.post(f"{URL}{trip['id']}/cancel/", {}, format="json").status_code == 400
        assert ActivityLog.objects.get(action="cancelled").changes == {
            "reason": "Road closed at Habarana"
        }

    def test_activate_and_deactivate(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(2, 9))

        assert admin_api.post(f"{URL}{trip['id']}/deactivate/").json()["active"] is False
        assert admin_api.post(f"{URL}{trip['id']}/activate/").json()["active"] is True

    def test_delete_only_without_bookings(self, admin_api, route, bus):
        free = create(admin_api, route, bus, local_datetime(2, 9))
        booked = create(admin_api, route, bus, local_datetime(3, 9))
        BookingFactory(trip=Trip.objects.get(pk=booked["id"]))

        assert admin_api.delete(f"{URL}{free['id']}/").status_code == 204
        assert admin_api.delete(f"{URL}{booked['id']}/").status_code == 409


class TestListAndDetail:
    def test_filters(self, admin_api, route, bus):
        other_route = create_route_with_stops(
            "Kandy – Ella", (("Kandy", 0, 0), ("Ella", 240, 240)), base_fare=Decimal("800")
        )
        other_bus = create_bookable_bus()
        a = create(admin_api, route, bus, local_datetime(2, 8))
        b = create(admin_api, other_route, other_bus, local_datetime(3, 8))
        admin_api.post(f"{URL}{b['id']}/cancel/", {}, format="json")

        def codes(**params):
            return sorted(t["code"] for t in admin_api.get(URL, params).json()["results"])

        assert codes(date=(timezone.localdate() + timedelta(days=2)).isoformat()) == [a["code"]]
        assert codes(route=str(route.id)) == [a["code"]]
        assert codes(bus=str(other_bus.id)) == [b["code"]]
        assert codes(operator=str(bus.operator_id)) == [a["code"]]
        assert codes(status="cancelled") == [b["code"]]
        assert codes(search=a["code"].lower()) == [a["code"]]

    def test_seat_availability_counts_only_active_bookings(self, admin_api, route, bus):
        trip = Trip.objects.get(pk=create(admin_api, route, bus, local_datetime(2, 8))["id"])
        confirmed = BookingFactory(trip=trip, status=BookingStatus.CONFIRMED)
        Passenger.objects.create(booking=confirmed, name="A", seat_number="1")
        Passenger.objects.create(booking=confirmed, name="B", seat_number="2")
        cancelled = BookingFactory(trip=trip, status=BookingStatus.CANCELLED)
        Passenger.objects.create(booking=cancelled, name="C", seat_number="3")

        [row] = admin_api.get(URL).json()["results"]

        assert (row["booking_count"], row["booked_seats"], row["available_seats"]) == (1, 2, 39)

    def test_detail_has_everything_the_trip_page_needs(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(2, 20, 30))

        body = admin_api.get(f"{URL}{trip['id']}/").json()

        assert body["route_summary"]["origin"]["name"] == "Colombo"
        assert body["route_summary"]["destination"]["name"] == "Batticaloa"
        assert body["bus_summary"]["seat_capacity"] == 41
        assert body["bus_summary"]["seat_layout_name"]
        assert len(body["stops"]) == 5
        assert body["stops"][0]["is_boarding_point"] is True
        assert body["stops"][-1]["is_dropoff_point"] is True


class TestRelationships:
    def test_moving_a_bus_to_another_operator_moves_its_open_trips(self, admin_api, route, bus):
        upcoming = Trip.objects.get(pk=create(admin_api, route, bus, local_datetime(2, 8))["id"])
        departed = TripFactory(
            route=route,
            bus=bus,
            departure_datetime=local_datetime(-3, 8),
            status=TripStatus.DEPARTED,
        )
        new_operator = OperatorFactory()

        response = admin_api.patch(
            f"/api/v1/admin/buses/{bus.id}/", {"operator": str(new_operator.id)}, format="json"
        )

        assert response.status_code == 200
        upcoming.refresh_from_db()
        departed.refresh_from_db()
        assert upcoming.operator_id == new_operator.id
        assert departed.operator_id == bus.operator_id  # history is kept

    def test_capacity_cannot_drop_below_seats_already_booked(self, admin_api, route, bus):
        trip = Trip.objects.get(pk=create(admin_api, route, bus, local_datetime(2, 8))["id"])
        booking = BookingFactory(trip=trip, status=BookingStatus.CONFIRMED)
        for seat in range(1, 6):
            Passenger.objects.create(booking=booking, name=f"P{seat}", seat_number=str(seat))

        response = admin_api.patch(
            f"/api/v1/admin/buses/{bus.id}/", {"seat_capacity": 4}, format="json"
        )

        assert response.status_code == 400
        assert "5 seats booked" in response.json()["error"]["details"]["seat_capacity"][0]

    def test_stops_on_a_trip_timetable_cannot_be_deleted(self, admin_api, route, bus):
        trip = create(admin_api, route, bus, local_datetime(2, 8))
        kadawatha = trip["stops"][1]["stop"]["id"]
        route.route_stops.filter(stop_id=kadawatha).delete()

        response = admin_api.delete(f"/api/v1/admin/stops/{kadawatha}/")

        assert response.status_code == 409
        assert "trip" in response.json()["error"]["message"]

    def test_bus_with_trips_cannot_be_deleted(self, admin_api, route, bus):
        create(admin_api, route, bus, local_datetime(2, 8))

        assert admin_api.delete(f"/api/v1/admin/buses/{bus.id}/").status_code == 409

    def test_trip_prices_are_never_negative_in_the_database(self, route, bus):
        with pytest.raises(IntegrityError), transaction.atomic():
            TripFactory(route=route, bus=bus, base_price=Decimal("-1"))
