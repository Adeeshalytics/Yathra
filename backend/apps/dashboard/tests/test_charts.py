"""
Phase 7: the dashboard charts.

One request returns every series the dashboard draws, already aggregated and zero-filled, so
the browser plots numbers rather than counting rows.
"""

import pytest
from django.utils import timezone

from apps.reports.tests.conftest import (  # noqa: F401 — shared fixtures
    CHARTS,
    alice,
    bob,
    bus,
    kandy_route,
    kandy_trip,
    ledger,
    route,
    staff,
    trip,
)

pytestmark = pytest.mark.django_db


def charts(client, query: str = "?range=today") -> dict:
    response = client.get(f"{CHARTS}{query}")
    assert response.status_code == 200, response.content
    return response.json()


class TestTheSeries:
    def test_bookings_and_seats_per_day(self, admin_api, ledger):
        body = charts(admin_api)

        assert len(body["bookings"]) == 1
        assert body["bookings"][0]["bookings"] == 3
        assert body["bookings"][0]["seats"] == 4

    def test_revenue_per_day_is_gross_refunds_and_net(self, admin_api, ledger):
        day = charts(admin_api)["revenue"][0]

        assert (day["gross"], day["refunds"], day["net"]) == ("8700.00", "2500.00", "6200.00")

    def test_cancellations_per_day(self, admin_api, ledger):
        assert charts(admin_api)["cancellations"][0]["cancellations"] == 1

    def test_occupancy_carries_the_days_and_the_total(self, admin_api, ledger):
        # Occupancy is measured on the day a trip runs, so the range has to reach the departures.
        today = timezone.localdate().isoformat()
        last_departure = ledger.kandy_trip.departure_datetime.date().isoformat()

        occupancy = charts(admin_api, f"?range=custom&date_from={today}&date_to={last_departure}")[
            "occupancy"
        ]

        assert occupancy["summary"]["seats_sold"] == 3
        assert occupancy["summary"]["capacity"] == 82
        assert {row["date"] for row in occupancy["by_date"]}  # one row per day in the range
        assert all(0 <= row["occupancy"] <= 100 for row in occupancy["by_date"])
        busiest = max(occupancy["by_date"], key=lambda row: row["seats_sold"])
        assert (busiest["seats_sold"], busiest["capacity"]) == (2, 41)

    def test_the_top_routes_are_ranked_by_takings(self, admin_api, ledger):
        routes = charts(admin_api, "?range=all")["top_routes"]

        assert [row["route_name"] for row in routes] == [
            "Colombo – Batticaloa",
            "Colombo – Kandy",
        ]
        assert routes[0]["net"] == "5000.00"
        assert routes[0]["seats_sold"] == 2

    def test_the_totals_summarise_the_range(self, admin_api, ledger):
        totals = charts(admin_api)["totals"]

        assert totals["bookings"] == 3
        assert totals["booking_value"] == "8700.00"
        assert totals["gross_revenue"] == "8700.00"
        assert totals["net_revenue"] == "6200.00"
        assert totals["cancellations"] == 1


class TestTheDateFilter:
    def test_a_range_is_zero_filled_day_by_day(self, admin_api, ledger):
        body = charts(admin_api, "?range=custom&date_from=2026-01-01&date_to=2026-01-07")

        assert len(body["bookings"]) == 7
        assert {row["bookings"] for row in body["bookings"]} == {0}
        assert {row["net"] for row in body["revenue"]} == {"0.00"}
        assert body["totals"]["bookings"] == 0

    def test_the_range_is_reported_back(self, admin_api, ledger):
        span = charts(admin_api, "?range=yesterday")["range"]

        assert span["key"] == "yesterday"
        assert span["from_date"] == span["to_date"]

    def test_every_series_is_the_same_length(self, admin_api, ledger):
        body = charts(admin_api, "?range=week")
        days = len(body["bookings"])

        assert days == len(body["revenue"]) == len(body["cancellations"])
        assert days == len(body["occupancy"]["by_date"])


class TestItIsAdminsOnly:
    def test_a_customer_is_refused(self, api_client, alice, ledger):
        api_client.force_authenticate(alice)

        assert api_client.get(CHARTS).status_code == 403

    def test_an_operator_is_refused(self, api_client, operator_user, ledger):
        api_client.force_authenticate(operator_user)

        assert api_client.get(CHARTS).status_code == 403

    def test_a_stranger_is_turned_away(self, api_client):
        assert api_client.get(CHARTS).status_code == 401
