"""
Phase 7: the seven admin reports.

Every total is worked out by the database, so these tests check the arithmetic rather than the
plumbing: the numbers must match the day's trading described in `conftest.Ledger`.
"""

import pytest

from .conftest import ADMIN_PASSENGERS, REPORTS, report_url

pytestmark = pytest.mark.django_db


def run(client, key: str, **params) -> dict:
    response = client.get(report_url(key, **params))
    assert response.status_code == 200, response.content
    return response.json()


def rows_by(body: dict, field: str) -> dict:
    return {row[field]: row for row in body["results"]}


class TestTheCatalogue:
    def test_it_lists_every_report_the_screen_can_run(self, admin_api):
        body = admin_api.get(REPORTS).json()

        assert [report["key"] for report in body["reports"]] == [
            "bookings",
            "passengers",
            "revenue",
            "routes",
            "occupancy",
            "cancellations",
            "payments",
        ]
        assert all(report["title"] and report["description"] for report in body["reports"])

    def test_it_names_the_date_filters_and_formats(self, admin_api):
        body = admin_api.get(REPORTS).json()

        assert [span["key"] for span in body["ranges"]] == [
            "today",
            "yesterday",
            "week",
            "month",
            "custom",
            "all",
        ]
        assert body["formats"] == ["csv", "xlsx", "pdf"]
        assert body["occupancy_groups"] == ["trip", "route", "bus", "date"]

    def test_an_unknown_report_is_a_404(self, admin_api):
        assert admin_api.get(f"{REPORTS}profits/").status_code == 404


class TestBookingReport:
    def test_it_counts_the_days_bookings_and_their_value(self, admin_api, ledger):
        body = run(admin_api, "bookings", range="today")

        assert body["summary"]["bookings"] == 3
        assert body["summary"]["seats"] == 4  # the cancelled seat was still sold once
        assert body["summary"]["value"] == "8700.00"
        assert body["summary"]["confirmed"] == 2
        assert body["summary"]["cancelled"] == 1
        assert body["summary"]["average_value"] == "2900.00"

    def test_each_row_carries_what_the_screen_shows(self, admin_api, ledger):
        body = run(admin_api, "bookings", range="today")
        row = rows_by(body, "booking_reference")[ledger.alice_booking["booking_reference"]]

        assert row["customer_name"] == "Alice Perera"
        assert row["route_name"] == "Colombo – Batticaloa"
        assert (row["seats"], row["total_amount"]) == (2, "5000.00")
        assert (row["paid_amount"], row["payment_status"]) == ("5000.00", "successful")
        assert row["status"] == "confirmed"

    def test_a_route_filter_narrows_it(self, admin_api, ledger):
        body = run(admin_api, "bookings", range="today", route=str(ledger.kandy_trip.route_id))

        assert body["summary"]["bookings"] == 1
        assert body["summary"]["value"] == "1200.00"

    def test_yesterday_was_quiet(self, admin_api, ledger):
        body = run(admin_api, "bookings", range="yesterday")

        assert (body["summary"]["bookings"], body["summary"]["value"]) == (0, "0.00")
        assert body["results"] == []


class TestPassengerReport:
    def test_it_lists_who_is_travelling(self, admin_api, ledger):
        body = run(admin_api, "passengers", range="all")

        assert body["summary"]["passengers"] == 4
        assert body["summary"]["travelling"] == 3  # the cancelled seat is no longer held
        assert body["summary"]["boarded"] == 0
        assert body["summary"]["not_boarded"] == 3

    def test_a_boarded_passenger_shows_as_boarded(self, admin_api, ledger):
        passenger = admin_api.get(f"{ADMIN_PASSENGERS}?trip={ledger.trip.pk}").json()["results"][0]
        admin_api.post(f"{ADMIN_PASSENGERS}{passenger['id']}/boarding/", {}, format="json")

        body = run(admin_api, "passengers", range="all", trip=str(ledger.trip.pk))

        assert body["summary"]["boarded"] == 1
        assert rows_by(body, "id")[passenger["id"]]["boarding_state"] == "boarded"

    def test_one_booking_at_a_time(self, admin_api, ledger):
        body = run(admin_api, "passengers", range="all", booking=ledger.alice_booking["id"])

        assert body["summary"]["passengers"] == 2
        assert {row["seat_number"] for row in body["results"]} == {"15", "16"}
        assert all(row["boarding_point"] == "Colombo" for row in body["results"])


class TestRevenueReport:
    def test_gross_refunds_and_net(self, admin_api, ledger):
        summary = run(admin_api, "revenue", range="today")["summary"]

        assert summary["gross_revenue"] == "8700.00"  # 5000 + 1200 + 2500
        assert summary["refunds"] == "2500.00"
        assert summary["net_revenue"] == "6200.00"
        assert (summary["bookings"], summary["payments"]) == (3, 3)
        assert summary["average_booking_value"] == "2066.67"

    def test_it_reports_a_row_per_day(self, admin_api, ledger):
        body = run(admin_api, "revenue", range="month")

        assert len(body["results"]) == 1
        assert body["results"][0]["net"] == "6200.00"
        assert [column["key"] for column in body["columns"]][:2] == ["day", "bookings"]


class TestRouteReport:
    def test_each_route_is_measured_on_seats_and_takings(self, admin_api, ledger):
        body = run(admin_api, "routes", range="all")
        routes = rows_by(body, "route_name")

        assert routes["Colombo – Batticaloa"]["seats_sold"] == 2
        assert routes["Colombo – Batticaloa"]["net"] == "5000.00"
        assert routes["Colombo – Batticaloa"]["cancellations"] == 1
        assert routes["Colombo – Kandy"]["seats_sold"] == 1
        assert routes["Colombo – Kandy"]["average_fare"] == "1200.00"

    def test_the_summary_names_the_best_route(self, admin_api, ledger):
        summary = run(admin_api, "routes", range="all")["summary"]

        assert summary["routes"] == 2
        assert summary["seats_sold"] == 3
        assert summary["net_revenue"] == "6200.00"
        assert summary["best_route"] == "Colombo – Batticaloa"


class TestOccupancyReport:
    def test_seats_sold_over_capacity(self, admin_api, ledger):
        summary = run(admin_api, "occupancy", range="all")["summary"]

        assert summary["capacity"] == 82
        assert summary["seats_sold"] == 3
        assert summary["occupancy"] == 3.7  # 3 / 82 × 100
        assert summary["empty_seats"] == 79

    def test_it_groups_by_trip_route_bus_or_date(self, admin_api, ledger):
        for group in ("trip", "route", "bus", "date"):
            body = run(admin_api, "occupancy", range="all", group_by=group)
            assert body["summary"]["group_by"] == group
            assert len(body["results"]) == 2

    def test_a_trip_row_shows_its_own_occupancy(self, admin_api, ledger):
        body = run(admin_api, "occupancy", range="all", group_by="trip")
        rows = rows_by(body, "trip_code")

        row = rows[ledger.trip.code]
        assert (row["seats_sold"], row["capacity"]) == (2, 41)
        assert row["occupancy"] == 4.9


class TestCancellationReport:
    def test_it_shows_what_was_cancelled_and_refunded(self, admin_api, ledger):
        body = run(admin_api, "cancellations", range="today")

        assert body["summary"]["cancellations"] == 1
        assert body["summary"]["seats_released"] == 1
        assert body["summary"]["value"] == "2500.00"
        assert body["summary"]["bookings_made"] == 3
        assert body["summary"]["cancellation_rate"] == 33.3
        assert body["summary"]["refunds_completed"] == "2500.00"
        assert body["summary"]["refunds_open"] == 0

    def test_the_row_keeps_the_reason(self, admin_api, ledger):
        row = run(admin_api, "cancellations", range="today")["results"][0]

        assert row["booking_reference"] == ledger.cancelled_booking["booking_reference"]
        assert row["cancellation_reason"] == "Meeting moved"
        assert (row["refund_amount"], row["refund_status"]) == ("2500.00", "completed")


class TestPaymentReport:
    def test_every_payment_and_what_became_of_it(self, admin_api, ledger):
        summary = run(admin_api, "payments", range="today")["summary"]

        assert (summary["payments"], summary["successful"]) == (3, 3)
        assert (summary["failed"], summary["cancelled"]) == (0, 0)
        assert summary["captured"] == "8700.00"
        assert summary["refunded"] == "2500.00"
        assert summary["net"] == "6200.00"
        assert summary["by_provider"] == [
            {"provider": "manual", "payments": 3, "amount": "8700.00"}
        ]

    def test_the_refunded_payment_is_marked(self, admin_api, ledger):
        rows = rows_by(run(admin_api, "payments", range="today"), "booking_reference")
        row = rows[ledger.cancelled_booking["booking_reference"]]

        assert row["status"] == "refunded"
        assert (row["amount"], row["refunded_amount"]) == ("2500.00", "2500.00")


class TestDateFilters:
    def test_a_custom_range_is_honoured(self, admin_api, ledger):
        today = run(admin_api, "bookings", range="today")["range"]["from_date"]

        body = run(admin_api, "bookings", range="custom", date_from=today, date_to=today)

        assert body["range"]["key"] == "custom"
        assert body["summary"]["bookings"] == 3

    def test_a_range_that_ended_before_trading_is_empty(self, admin_api, ledger):
        body = run(
            admin_api,
            "bookings",
            range="custom",
            date_from="2020-01-01",
            date_to="2020-01-31",
        )

        assert body["summary"]["bookings"] == 0

    def test_all_time_has_no_bounds(self, admin_api, ledger):
        body = run(admin_api, "bookings", range="all")

        assert body["range"]["from_date"] is None
        assert body["summary"]["bookings"] == 3


class TestReportsArePagedNotDumped:
    def test_rows_arrive_a_page_at_a_time(self, admin_api, ledger):
        body = run(admin_api, "payments", range="all", page_size=2)

        assert body["count"] == 3
        assert len(body["results"]) == 2
        assert body["next"] is not None


class TestOnlyAdminsMayReport:
    @pytest.mark.parametrize("path", [REPORTS, f"{REPORTS}revenue/", f"{REPORTS}revenue/export/"])
    def test_a_customer_is_refused(self, api_client, customer, path):
        api_client.force_authenticate(customer)

        assert api_client.get(path).status_code == 403

    @pytest.mark.parametrize("path", [REPORTS, f"{REPORTS}revenue/"])
    def test_an_operator_is_refused(self, api_client, operator_user, path):
        api_client.force_authenticate(operator_user)

        assert api_client.get(path).status_code == 403

    def test_a_stranger_is_refused(self, api_client):
        assert api_client.get(REPORTS).status_code == 401
