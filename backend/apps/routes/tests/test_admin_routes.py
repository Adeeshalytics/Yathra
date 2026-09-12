import pytest

from apps.audit.models import ActivityLog
from apps.core.tests.factories import StopFactory, TripFactory
from apps.routes.models import Route, RouteStop

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/routes/"
TOWNS = ["Colombo", "Kadawatha", "Kurunegala", "Dambulla", "Habarana", "Batticaloa"]


@pytest.fixture
def stops(db):
    return {name: StopFactory(name=name, city=name) for name in TOWNS}


def entry(stop, arrival, departure=None, *, board=True, drop=True):
    return {
        "stop": str(stop.id),
        "arrival_offset_minutes": arrival,
        "departure_offset_minutes": arrival if departure is None else departure,
        "is_boarding_point": board,
        "is_dropoff_point": drop,
    }


def timetable(stops):
    s = stops
    return [
        entry(s["Colombo"], 0, drop=False),
        entry(s["Kadawatha"], 45, 50),
        entry(s["Kurunegala"], 150, 160),
        entry(s["Dambulla"], 240, 250),
        entry(s["Habarana"], 290, 295),
        entry(s["Batticaloa"], 450, board=False),
    ]


def route_payload(stops, **overrides):
    return {
        "name": "Colombo – Batticaloa",
        "route_number": " 48a ",
        "description": "Via Kurunegala and Habarana.",
        "base_fare": "1850.00",
        "stops": timetable(stops),
        **overrides,
    }


def test_create_route_with_ordered_stops(admin_api, stops):
    response = admin_api.post(URL, route_payload(stops), format="json")

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["origin"]["name"] == "Colombo"
    assert body["destination"]["name"] == "Batticaloa"
    assert body["route_number"] == "48A"
    assert (body["stop_count"], body["duration_minutes"]) == (6, 450)
    assert [s["sequence"] for s in body["stops"]] == [1, 2, 3, 4, 5, 6]
    assert [s["stop"]["name"] for s in body["stops"]] == TOWNS
    assert body["stops"][1]["departure_offset_minutes"] == 50


def _single_stop(entries):
    del entries[1:]


def _duplicate_stop(entries):
    entries[2]["stop"] = entries[1]["stop"]


def _departs_before_arriving(entries):
    entries[2]["departure_offset_minutes"] = 100


def _out_of_order(entries):
    entries[2], entries[3] = entries[3], entries[2]


def _origin_offset(entries):
    entries[0]["arrival_offset_minutes"] = entries[0]["departure_offset_minutes"] = 10


def _origin_not_boarding(entries):
    entries[0]["is_boarding_point"] = False


def _destination_not_dropoff(entries):
    entries[-1]["is_dropoff_point"] = False


def _negative_offset(entries):
    entries[1]["arrival_offset_minutes"] = -5


def _unknown_stop(entries):
    entries[1]["stop"] = "00000000-0000-0000-0000-000000000000"


@pytest.mark.parametrize(
    "break_route",
    [
        _single_stop,
        _duplicate_stop,
        _departs_before_arriving,
        _out_of_order,
        _origin_offset,
        _origin_not_boarding,
        _destination_not_dropoff,
        _negative_offset,
        _unknown_stop,
    ],
)
def test_invalid_timetables_are_rejected(admin_api, stops, break_route):
    data = route_payload(stops)
    break_route(data["stops"])

    response = admin_api.post(URL, data, format="json")

    assert response.status_code == 400
    assert "stops" in response.json()["error"]["details"]
    assert not Route.objects.exists()


def test_stops_are_required_on_create(admin_api, stops):
    data = route_payload(stops)
    del data["stops"]

    response = admin_api.post(URL, data, format="json")

    assert response.status_code == 400
    assert "stops" in response.json()["error"]["details"]


@pytest.mark.parametrize("fare", ["-1.00", "abc"])
def test_negative_or_invalid_fares_are_rejected(admin_api, stops, fare):
    response = admin_api.post(URL, route_payload(stops, base_fare=fare), format="json")

    assert response.status_code == 400
    assert "base_fare" in response.json()["error"]["details"]


def test_updating_stops_reorders_and_moves_the_endpoints(admin_api, stops):
    route_id = admin_api.post(URL, route_payload(stops), format="json").json()["id"]
    s = stops
    shorter = [
        entry(s["Colombo"], 0),
        entry(s["Kurunegala"], 140, 150),
        entry(s["Kadawatha"], 200, 205),
        entry(s["Dambulla"], 260),
    ]

    response = admin_api.patch(f"{URL}{route_id}/", {"stops": shorter}, format="json")

    assert response.status_code == 200, response.content
    body = response.json()
    assert [x["stop"]["name"] for x in body["stops"]] == [
        "Colombo",
        "Kurunegala",
        "Kadawatha",
        "Dambulla",
    ]
    assert body["destination"]["name"] == "Dambulla"
    assert RouteStop.objects.filter(route_id=route_id).count() == 4
    assert ActivityLog.objects.get(action="updated").changes == {"fields": ["destination", "stops"]}


def test_patch_without_stops_leaves_them_untouched(admin_api, stops):
    route_id = admin_api.post(URL, route_payload(stops), format="json").json()["id"]

    response = admin_api.patch(f"{URL}{route_id}/", {"name": "Colombo – Batti"}, format="json")

    assert response.status_code == 200
    assert response.json()["stop_count"] == 6
    assert ActivityLog.objects.get(action="updated").changes == {"fields": ["name"]}


def test_filters_and_search(admin_api, stops):
    admin_api.post(URL, route_payload(stops), format="json")
    s = stops
    admin_api.post(
        URL,
        {
            "name": "Kadawatha – Dambulla",
            "stops": [entry(s["Kadawatha"], 0), entry(s["Dambulla"], 180)],
        },
        format="json",
    )
    Route.objects.filter(name="Kadawatha – Dambulla").update(active=False)

    def names(**params):
        return sorted(r["name"] for r in admin_api.get(URL, params).json()["results"])

    assert names(stop=str(s["Habarana"].id)) == ["Colombo – Batticaloa"]
    assert names(active="false") == ["Kadawatha – Dambulla"]
    assert names(origin=str(s["Kadawatha"].id)) == ["Kadawatha – Dambulla"]
    assert names(search="batti") == ["Colombo – Batticaloa"]


def test_activate_and_deactivate(admin_api, stops):
    route_id = admin_api.post(URL, route_payload(stops), format="json").json()["id"]

    assert admin_api.post(f"{URL}{route_id}/deactivate/").json()["active"] is False
    assert admin_api.post(f"{URL}{route_id}/activate/").json()["active"] is True


def test_delete_route_without_trips_removes_its_stops(admin_api, stops):
    route_id = admin_api.post(URL, route_payload(stops), format="json").json()["id"]

    assert admin_api.delete(f"{URL}{route_id}/").status_code == 204
    assert not RouteStop.objects.filter(route_id=route_id).exists()


def test_delete_is_blocked_when_the_route_has_trips(admin_api):
    trip = TripFactory()

    response = admin_api.delete(f"{URL}{trip.route_id}/")

    assert response.status_code == 409
    assert Route.objects.filter(pk=trip.route_id).exists()
