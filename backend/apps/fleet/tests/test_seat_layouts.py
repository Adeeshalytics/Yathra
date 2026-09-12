import copy

import pytest

from apps.audit.models import ActivityLog
from apps.core.tests.factories import BusFactory, create_seat_layout
from apps.fleet.models import Seat, SeatLayout
from apps.fleet.seat_layouts import generate_layout

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/seat-layouts/"


def layout_payload(name="Standard 45", layout_type="2x2", passenger_rows=11, **overrides):
    spec = generate_layout(layout_type, passenger_rows)
    return {
        "name": name,
        "layout_type": layout_type,
        "rows": spec["rows"],
        "columns": spec["columns"],
        "seats": spec["seats"],
        **overrides,
    }


class TestGenerate:
    def test_two_plus_two(self, admin_api):
        response = admin_api.post(
            f"{URL}generate/", {"layout_type": "2x2", "passenger_rows": 11}, format="json"
        )

        assert response.status_code == 200
        body = response.json()
        assert (body["rows"], body["columns"]) == (12, 5)
        assert body["seat_count"] == 45  # 10 rows x 4 + a full back row of 5
        passenger = [s for s in body["seats"] if s["seat_type"] not in ("driver", "conductor")]
        assert [s["seat_number"] for s in passenger] == [str(n) for n in range(1, 46)]
        aisle = [s for s in passenger if s["column"] == 3]
        assert [s["row"] for s in aisle] == [12]  # only the back row fills the aisle
        assert [s["seat_type"] for s in passenger[:4]] == ["window", "aisle", "aisle", "window"]

    def test_two_plus_one(self, admin_api):
        body = admin_api.post(
            f"{URL}generate/", {"layout_type": "2x1", "passenger_rows": 10}, format="json"
        ).json()

        assert (body["columns"], body["seat_count"]) == (4, 31)  # 9 x 3 + back row of 4

    def test_options(self, admin_api):
        body = admin_api.post(
            f"{URL}generate/",
            {
                "layout_type": "2x2",
                "passenger_rows": 5,
                "back_row_full": False,
                "conductor_seat": False,
            },
            format="json",
        ).json()

        assert body["seat_count"] == 20
        assert [s["seat_type"] for s in body["seats"]].count("conductor") == 0

    @pytest.mark.parametrize(
        "data",
        [
            {"layout_type": "3x3", "passenger_rows": 10},
            {"layout_type": "2x2", "passenger_rows": 1},
            {"layout_type": "2x2", "passenger_rows": 99},
        ],
    )
    def test_rejects_bad_parameters(self, admin_api, data):
        assert admin_api.post(f"{URL}generate/", data, format="json").status_code == 400


def test_create_layout_with_seats(admin_api):
    data = layout_payload()
    data["seats"][2]["seat_type"] = "reserved"  # seat 1
    data["seats"][3]["is_available"] = False  # seat 2

    response = admin_api.post(URL, data, format="json")

    assert response.status_code == 201, response.content
    body = response.json()
    assert (body["seat_count"], body["bookable_seat_count"], body["bus_count"]) == (45, 43, 0)
    assert len(body["seats"]) == 47  # + driver and conductor
    assert Seat.objects.filter(layout_id=body["id"]).count() == 47


def test_crew_seats_are_never_bookable(admin_api):
    data = layout_payload()
    driver = next(s for s in data["seats"] if s["seat_type"] == "driver")
    driver["is_available"] = True

    response = admin_api.post(URL, data, format="json")

    assert response.status_code == 201
    assert (
        Seat.objects.get(layout_id=response.json()["id"], seat_type="driver").is_available is False
    )


def _duplicate_position(seats):
    seats[3]["row"], seats[3]["column"] = seats[2]["row"], seats[2]["column"]


def _duplicate_number(seats):
    seats[2]["seat_number"], seats[3]["seat_number"] = "1a", "1A"


def _outside_grid(seats):
    seats[2]["row"] = 40


def _no_driver(seats):
    seats[:] = [s for s in seats if s["seat_type"] != "driver"]


def _two_drivers(seats):
    seats[2]["seat_type"] = "driver"


def _no_passengers(seats):
    seats[:] = [s for s in seats if s["seat_type"] == "driver"]


def _bad_seat_number(seats):
    seats[2]["seat_number"] = "1@"


def _bad_seat_type(seats):
    seats[2]["seat_type"] = "sleeper"


@pytest.mark.parametrize(
    "break_layout",
    [
        _duplicate_position,
        _duplicate_number,
        _outside_grid,
        _no_driver,
        _two_drivers,
        _no_passengers,
        _bad_seat_number,
        _bad_seat_type,
    ],
)
def test_invalid_seat_configurations_are_rejected(admin_api, break_layout):
    data = layout_payload()
    break_layout(data["seats"])

    response = admin_api.post(URL, data, format="json")

    assert response.status_code == 400
    assert "seats" in response.json()["error"]["details"]
    assert not SeatLayout.objects.exists()


def test_grid_dimensions_are_bounded(admin_api):
    response = admin_api.post(URL, layout_payload(columns=9), format="json")
    assert response.status_code == 400
    assert "columns" in response.json()["error"]["details"]


def test_duplicate_names_are_rejected_case_insensitively(admin_api):
    create_seat_layout(name="Standard 45")

    response = admin_api.post(URL, layout_payload(name="standard  45"), format="json")

    assert response.status_code == 400
    assert "name" in response.json()["error"]["details"]


def test_updating_seats_replaces_them(admin_api):
    layout = create_seat_layout("2x2", passenger_rows=10)
    smaller = generate_layout("2x2", 5)

    response = admin_api.patch(
        f"{URL}{layout.id}/",
        {"rows": smaller["rows"], "seats": smaller["seats"]},
        format="json",
    )

    assert response.status_code == 200, response.content
    assert response.json()["seat_count"] == 21
    assert layout.seats.count() == 23
    assert ActivityLog.objects.get(action="updated").changes == {"fields": ["rows", "seats"]}


def test_resubmitting_identical_seats_is_not_logged_as_a_change(admin_api):
    layout = create_seat_layout()
    seats = list(layout.seats.values("seat_number", "row", "column", "seat_type", "is_available"))

    admin_api.patch(f"{URL}{layout.id}/", {"seats": seats}, format="json")

    assert not ActivityLog.objects.filter(action="updated").exists()


def test_cannot_shrink_below_an_assigned_buses_capacity(admin_api):
    layout = create_seat_layout("2x2", passenger_rows=10)  # 41 bookable seats
    bus = BusFactory(seat_layout=layout, seat_capacity=41)
    seats = copy.deepcopy(generate_layout("2x2", 10)["seats"])
    seats[2]["is_available"] = False

    response = admin_api.patch(f"{URL}{layout.id}/", {"seats": seats}, format="json")

    assert response.status_code == 400
    assert bus.registration_number in response.json()["error"]["details"]["seats"][0]


def test_shrinking_the_grid_must_keep_existing_seats_inside_it(admin_api):
    layout = create_seat_layout("2x2", passenger_rows=10)

    response = admin_api.patch(f"{URL}{layout.id}/", {"rows": 5}, format="json")

    assert response.status_code == 400
    assert "seats" in response.json()["error"]["details"]


def test_list_shows_counts_but_not_seats(admin_api):
    layout = create_seat_layout()
    BusFactory(seat_layout=layout, seat_capacity=40)

    [item] = admin_api.get(URL).json()["results"]

    assert (item["bus_count"], item["seat_count"]) == (1, 41)
    assert "seats" not in item


def test_delete_is_blocked_while_buses_use_the_layout(admin_api):
    layout = create_seat_layout()
    BusFactory(seat_layout=layout, seat_capacity=40)
    unused = create_seat_layout()

    assert admin_api.delete(f"{URL}{layout.id}/").status_code == 409
    assert admin_api.delete(f"{URL}{unused.id}/").status_code == 204
    assert not Seat.objects.filter(layout_id=unused.id).exists()
