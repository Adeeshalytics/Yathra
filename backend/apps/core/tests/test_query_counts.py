"""
Query budgets: a page of rows must cost the same number of queries however many rows it holds.

These are N+1 regression tests. Each one asks for one row, counts the queries, then asks for
several and asserts the count has not moved — a per-row query would show up immediately. The
budgets are deliberately loose; what matters is that they do not grow with the data.

The count has to be read straight after the block that captured it: Django clears its query log
at the start of every request, so a later request would empty the record.
"""

import pytest
from django.utils import timezone

from apps.bookings.models import Booking
from apps.bookings.tests.conftest import hold_and_book
from apps.core.tests.factories import CustomerFactory, create_bookable_bus
from apps.trips.tests.conftest import local_datetime

from .conftest import client_for, make_trip

pytestmark = pytest.mark.django_db

SEATS = ["10", "11", "12", "13", "14", "15", "16", "17"]


def confirmed_bookings(trip, staff, seats) -> list[dict]:
    """One separate customer per seat, each with a confirmed booking on this trip."""
    made = []
    for seat in seats:
        customer = CustomerFactory(name=f"Customer {seat}")
        response = hold_and_book(client_for(customer), trip, seat)
        assert response.status_code == 201, response.content
        booking = response.json()
        confirmed = client_for(staff).post(f"/api/v1/bookings/{booking['id']}/confirm/")
        assert confirmed.status_code == 200, confirmed.content
        made.append(booking)
    return made


class TestAdminListsDoNotQueryPerRow:
    def test_bookings(self, django_assert_max_num_queries, admin_api, trip, staff):
        confirmed_bookings(trip, staff, SEATS[:1])
        with django_assert_max_num_queries(15) as one:
            assert admin_api.get("/api/v1/admin/bookings/").status_code == 200
        budget = len(one.captured_queries)

        confirmed_bookings(trip, staff, SEATS[1:5])
        with django_assert_max_num_queries(budget):
            body = admin_api.get("/api/v1/admin/bookings/").json()

        assert body["count"] == 5

    def test_passengers(self, django_assert_max_num_queries, admin_api, trip, staff):
        confirmed_bookings(trip, staff, SEATS[:1])
        with django_assert_max_num_queries(15) as one:
            assert admin_api.get("/api/v1/admin/passengers/").status_code == 200
        budget = len(one.captured_queries)

        confirmed_bookings(trip, staff, SEATS[1:5])
        with django_assert_max_num_queries(budget):
            body = admin_api.get("/api/v1/admin/passengers/").json()

        assert body["count"] == 5

    def test_trips(self, django_assert_max_num_queries, admin_api, route, bus):
        make_trip(route, bus, local_datetime(4, 20, 30))
        with django_assert_max_num_queries(15) as one:
            assert admin_api.get("/api/v1/admin/trips/").status_code == 200
        budget = len(one.captured_queries)

        # A bus cannot be on two journeys at once, so each extra trip gets its own.
        for index, hour in enumerate((6, 8, 10, 12)):
            make_trip(
                route,
                create_bookable_bus(registration_number=f"WP NX-{index}"),
                local_datetime(5, hour, 0),
            )
        with django_assert_max_num_queries(budget):
            body = admin_api.get("/api/v1/admin/trips/").json()

        assert body["count"] == 5

    def test_payments(self, django_assert_max_num_queries, admin_api, trip, staff):
        confirmed_bookings(trip, staff, SEATS[:1])
        with django_assert_max_num_queries(15) as one:
            assert admin_api.get("/api/v1/admin/payments/").status_code == 200
        budget = len(one.captured_queries)

        confirmed_bookings(trip, staff, SEATS[1:5])
        with django_assert_max_num_queries(budget):
            assert admin_api.get("/api/v1/admin/payments/").json()["count"] == 5


class TestCustomerScreensDoNotQueryPerRow:
    def test_search_results(self, django_assert_max_num_queries, api_client, route, bus):
        day = local_datetime(4, 20, 30)
        make_trip(route, bus, day)
        params = {
            "from": "Colombo",
            "to": "Batticaloa",
            "date": timezone.localdate(day).isoformat(),
        }
        with django_assert_max_num_queries(15) as one:
            assert api_client.get("/api/v1/trips/search/", params).status_code == 200
        budget = len(one.captured_queries)

        for index, hour in enumerate((6, 8, 10, 12)):
            make_trip(
                route,
                create_bookable_bus(registration_number=f"WP NY-{index}"),
                local_datetime(4, hour, 0),
            )
        with django_assert_max_num_queries(budget):
            body = api_client.get("/api/v1/trips/search/", params).json()

        assert body["count"] == 5

    def test_my_bookings(self, django_assert_max_num_queries, trip, alice, staff):
        client = client_for(alice)
        first = hold_and_book(client, trip, "15").json()
        client_for(staff).post(f"/api/v1/bookings/{first['id']}/confirm/")
        with django_assert_max_num_queries(20) as one:
            assert client.get("/api/v1/bookings/").status_code == 200
        budget = len(one.captured_queries)

        for seat in ("16", "17", "18"):
            booking = hold_and_book(client, trip, seat).json()
            client_for(staff).post(f"/api/v1/bookings/{booking['id']}/confirm/")
        with django_assert_max_num_queries(budget):
            body = client.get("/api/v1/bookings/").json()

        assert body["count"] == 4

    def test_the_seat_map_is_a_fixed_cost(self, django_assert_max_num_queries, trip, alice, staff):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "10").json()
        client_for(staff).post(f"/api/v1/bookings/{booking['id']}/confirm/")
        with django_assert_max_num_queries(15) as one:
            assert client.get(f"/api/v1/trips/{trip.pk}/seats/").status_code == 200
        budget = len(one.captured_queries)

        for seat in SEATS[1:5]:
            booking = hold_and_book(client, trip, seat).json()
            client_for(staff).post(f"/api/v1/bookings/{booking['id']}/confirm/")
        with django_assert_max_num_queries(budget):
            body = client.get(f"/api/v1/trips/{trip.pk}/seats/").json()

        assert sum(1 for seat in body["seats"] if seat["status"] == "booked") == 5


class TestReportsAggregateInTheDatabase:
    @pytest.mark.parametrize(
        "key",
        ["bookings", "passengers", "revenue", "routes", "occupancy", "cancellations", "payments"],
    )
    def test_a_report_costs_the_same_however_many_rows_it_covers(
        self, django_assert_max_num_queries, admin_api, trip, staff, key
    ):
        url = f"/api/v1/admin/reports/{key}/?range=all"
        confirmed_bookings(trip, staff, SEATS[:1])
        with django_assert_max_num_queries(20) as one:
            assert admin_api.get(url).status_code == 200
        budget = len(one.captured_queries)

        confirmed_bookings(trip, staff, SEATS[1:5])
        with django_assert_max_num_queries(budget):
            assert admin_api.get(url).status_code == 200

    def test_the_dashboard_charts_are_one_round_of_aggregates(
        self, django_assert_max_num_queries, admin_api, trip, staff
    ):
        confirmed_bookings(trip, staff, SEATS[:2])

        with django_assert_max_num_queries(25):
            assert admin_api.get("/api/v1/admin/dashboard/charts/?range=month").status_code == 200


class TestWritesStayBounded:
    def test_booking_a_seat_is_a_fixed_number_of_queries(
        self, django_assert_max_num_queries, trip, alice
    ):
        # Two requests: lock the seat, then book it (both take the trip row lock).
        with django_assert_max_num_queries(40):
            response = hold_and_book(client_for(alice), trip, "15")

        assert response.status_code == 201
        assert Booking.objects.count() == 1
