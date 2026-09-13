"""
The operator portal: a bus company sees its own trips, bookings, manifests and takings —
never another company's, and only owners and managers see the money.
"""

import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.bookings.tests.conftest import (  # noqa: F401 — shared fixtures
    alice,
    bob,
    bus,
    client_for,
    hold_and_book,
    make_trip,
    route,
    staff,
    trip,
)
from apps.core.tests.factories import (
    AdminFactory,
    CustomerFactory,
    OperatorMembershipFactory,
    OperatorUserFactory,
    create_bookable_bus,
    create_route_with_stops,
)
from apps.operators.models import OperatorMemberRole, OperatorStatus
from apps.trips.tests.conftest import local_datetime

pytestmark = pytest.mark.django_db

API = "/api/v1/operator/"
KANDY_PLAN = (("Colombo", 0, 0), ("Kegalle", 90, 95), ("Kandy", 180, 180))


def member(operator, role=OperatorMemberRole.OWNER, **fields):
    return OperatorMembershipFactory(
        operator=operator, user=OperatorUserFactory(), role=role, **fields
    ).user


def paid_booking(customer, on_trip, staff_user, *seats, **stops) -> dict:
    booking = hold_and_book(client_for(customer), on_trip, *seats, **stops).json()
    response = client_for(staff_user).post(f"/api/v1/bookings/{booking['id']}/confirm/")
    assert response.status_code == 200, response.content
    return response.json()


@pytest.fixture
def ours(trip):
    return trip.operator


@pytest.fixture
def owner(ours):
    return member(ours)


@pytest.fixture
def conductor(ours):
    return member(ours, OperatorMemberRole.STAFF)


@pytest.fixture
def other_trip(db):
    route = create_route_with_stops("Colombo – Kandy", KANDY_PLAN, base_fare=Decimal("1200.00"))
    return make_trip(
        route, create_bookable_bus(registration_number="CP ND-1111"), local_datetime(3, 9)
    )


@pytest.fixture
def rival(other_trip):
    return member(other_trip.operator)


@pytest.fixture
def sales(trip, other_trip, alice, bob, staff):
    """Alice paid for two seats on our trip, Bob hasn't paid for his, and Carol travels with the
    other company."""
    carol = CustomerFactory(name="Carol Jayasuriya")
    return {
        "alice": paid_booking(alice, trip, staff, "15", "16"),
        "bob": hold_and_book(client_for(bob), trip, "20").json(),
        "carol": paid_booking(carol, other_trip, staff, "5", dropoff="Kandy"),
    }


ENDPOINTS = ["dashboard/", "trips/", "bookings/", "reports/revenue/"]


class TestWhoMayUseThePortal:
    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_signed_out_visitors_are_turned_away(self, path):
        assert APIClient().get(API + path).status_code == 401

    @pytest.mark.parametrize("path", ENDPOINTS)
    @pytest.mark.parametrize("factory", [CustomerFactory, AdminFactory])
    def test_customers_and_admins_are_not_operators(self, path, factory):
        assert client_for(factory()).get(API + path).status_code == 403

    @pytest.mark.parametrize("status", [OperatorStatus.PENDING, OperatorStatus.SUSPENDED])
    def test_a_company_that_is_not_approved_sees_nothing(self, ours, owner, status):
        ours.status = status
        ours.save()

        for path in ENDPOINTS:
            assert client_for(owner).get(API + path).status_code == 403

    def test_a_removed_member_sees_nothing(self, ours):
        former = member(ours, is_active=False)

        assert client_for(former).get(API + "trips/").status_code == 403

    def test_staff_see_the_trips_but_not_the_money(self, conductor, sales):
        client = client_for(conductor)

        assert client.get(API + "trips/").status_code == 200
        assert client.get(API + "bookings/").status_code == 200
        dashboard = client.get(API + "dashboard/").json()
        assert (dashboard["can_see_revenue"], dashboard["revenue"]) == (False, None)
        assert client.get(API + "reports/revenue/").status_code == 403
        assert client.get(API + "reports/revenue/export/?format=csv").status_code == 403

    def test_a_manager_sees_the_money(self, ours, sales):
        manager = member(ours, OperatorMemberRole.MANAGER)

        assert client_for(manager).get(API + "reports/revenue/").status_code == 200


class TestTrips:
    def test_the_list_is_only_the_companys_own_trips_with_their_seats(
        self, trip, other_trip, owner, sales
    ):
        body = client_for(owner).get(API + "trips/").json()

        assert [row["id"] for row in body["results"]] == [str(trip.pk)]
        row = body["results"][0]
        assert (row["seats_sold"], row["capacity"], row["boarded"]) == (3, 41, 0)
        assert row["occupancy"] == 7.3
        assert row["route_name"] == "Colombo – Batticaloa"
        assert row["bus_registration"] == "WP NC-4521"

    def test_another_companys_trip_is_not_found(self, other_trip, owner):
        client = client_for(owner)

        for suffix in ("", "manifest/", "manifest/pdf/"):
            assert client.get(f"{API}trips/{other_trip.pk}/{suffix}").status_code == 404

    def test_upcoming_and_past(self, trip, owner, bus, route):
        yesterday = make_trip(
            route, create_bookable_bus(operator=trip.operator), local_datetime(-1, 8)
        )
        client = client_for(owner)

        upcoming = client.get(API + "trips/?when=upcoming").json()["results"]
        past = client.get(API + "trips/?when=past").json()["results"]

        assert [row["id"] for row in upcoming] == [str(trip.pk)]
        assert [row["id"] for row in past] == [str(yesterday.pk)]

    def test_a_trip_shows_its_stops_bookings_and_takings(self, trip, owner, conductor, sales):
        body = client_for(owner).get(f"{API}trips/{trip.pk}/").json()

        assert [stop["name"] for stop in body["stops"]] == [
            "Colombo",
            "Kadawatha",
            "Kurunegala",
            "Dambulla",
            "Batticaloa",
        ]
        assert body["bookings"] == {"confirmed": 1, "awaiting_payment": 1, "cancelled": 0}
        assert body["revenue"]["gross_revenue"] == "5000.00"

        assert client_for(conductor).get(f"{API}trips/{trip.pk}/").json()["revenue"] is None

    def test_the_manifest_lists_who_is_travelling(self, trip, conductor, sales):
        client = client_for(conductor)

        manifest = client.get(f"{API}trips/{trip.pk}/manifest/").json()
        pdf = client.get(f"{API}trips/{trip.pk}/manifest/pdf/")

        assert [p["seat_number"] for p in manifest["passengers"]] == ["15", "16", "20"]
        assert manifest["counts"]["passengers"] == 3
        assert pdf.status_code == 200 and pdf["Content-Type"] == "application/pdf"


class TestBookings:
    def test_the_list_is_only_bookings_on_the_companys_trips(self, owner, sales):
        body = client_for(owner).get(API + "bookings/").json()

        references = {row["booking_reference"] for row in body["results"]}
        assert references == {
            sales["alice"]["booking_reference"],
            sales["bob"]["booking_reference"],
        }

    def test_search_finds_a_passenger_by_phone_however_it_is_typed(self, owner, sales):
        client = client_for(owner)

        for typed in ("077 123 4567", "0771234567", "+94771234567"):
            body = client.get(API + "bookings/", {"search": typed}).json()
            assert body["count"] == 2, typed

    def test_another_companys_booking_is_not_found(self, owner, sales):
        response = client_for(owner).get(f"{API}bookings/{sales['carol']['id']}/")

        assert response.status_code == 404

    def test_a_booking_shows_what_the_crew_needs_and_nothing_private(self, owner, alice, sales):
        booking = sales["alice"]
        body = client_for(owner).get(f"{API}bookings/{booking['id']}/").json()

        assert body["booking_reference"] == booking["booking_reference"]
        assert body["customer"] == {"name": alice.name, "phone": alice.phone}
        assert [p["seat_number"] for p in body["passengers"]] == ["15", "16"]
        assert body["passengers"][0]["phone"] == "+94771234567"
        assert body["boarding"]["name"] == "Colombo"
        assert body["paid_amount"] == "5000.00"
        assert body["ticket"]["status"] == "valid"
        raw = json.dumps(body)
        assert alice.email not in raw
        assert "share" not in raw and "transaction" not in raw and "qr" not in raw


class TestDashboard:
    def test_today_next_departures_and_takings(self, trip, owner, alice, staff, sales):
        soon = timezone.now() + timedelta(minutes=45)
        if timezone.localtime(soon).date() != timezone.localdate():
            pytest.skip("Too close to midnight for a trip that leaves today.")
        today_trip = make_trip(trip.route, create_bookable_bus(operator=trip.operator), soon)
        paid_booking(alice, today_trip, staff, "1")

        body = client_for(owner).get(API + "dashboard/").json()

        assert body["operator"]["company_name"] == trip.operator.company_name
        assert body["role"] == "owner"
        assert body["today"]["trips"] == 1
        assert body["today"]["passengers"] == 1
        assert body["today"]["bookings_sold"] == 2  # Alice's two bookings were paid today
        assert [t["id"] for t in body["upcoming"]["trips"]] == [str(today_trip.pk), str(trip.pk)]
        assert body["revenue"]["today"]["gross_revenue"] == "7500.00"
        assert body["revenue"]["month"]["bookings"] >= 2


class TestRevenue:
    def test_only_the_companys_takings_are_counted_whatever_is_asked(
        self, owner, other_trip, sales
    ):
        client = client_for(owner)

        mine = client.get(API + "reports/revenue/?range=all").json()
        sneaky = client.get(
            f"{API}reports/revenue/?range=all&operator={other_trip.operator.pk}"
        ).json()

        assert mine["summary"]["gross_revenue"] == "5000.00"
        assert sneaky["summary"] == mine["summary"]

    def test_takings_by_route(self, owner, sales):
        body = client_for(owner).get(API + "reports/routes/?range=all").json()

        assert [row["route_name"] for row in body["results"]] == ["Colombo – Batticaloa"]

    def test_the_report_downloads(self, owner, sales):
        response = client_for(owner).get(API + "reports/revenue/export/?range=all&format=csv")

        assert response.status_code == 200
        assert response["Content-Type"].startswith("text/csv")

    def test_only_revenue_and_routes_are_on_offer(self, owner, sales):
        client = client_for(owner)

        for key in ("payments", "passengers", "cancellations", "bookings"):
            assert client.get(f"{API}reports/{key}/").status_code == 404


class TestQueryBudget:
    def test_lists_do_not_grow_a_query_per_row(
        self, trip, owner, alice, staff, django_assert_max_num_queries
    ):
        client = client_for(owner)
        paid_booking(alice, trip, staff, "1")
        with django_assert_max_num_queries(20) as one:
            client.get(API + "bookings/")
            client.get(API + "trips/")
        budget = len(one.captured_queries)

        for index, seat in enumerate(["2", "3", "4", "5"]):
            extra = make_trip(
                trip.route,
                create_bookable_bus(operator=trip.operator, registration_number=f"QB-{index}"),
                trip.departure_datetime + timedelta(days=index + 1),
            )
            paid_booking(alice, extra, staff, seat)

        with django_assert_max_num_queries(budget):
            client.get(API + "bookings/")
            client.get(API + "trips/")
