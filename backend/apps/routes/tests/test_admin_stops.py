import pytest

from apps.core.tests.factories import RouteFactory, StopFactory
from apps.routes.models import RouteStop, Stop

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/stops/"


def test_create_stop(admin_api):
    response = admin_api.post(
        URL,
        {
            "name": " Kandy  Goods Shed ",
            "city": "Kandy",
            "latitude": "7.2919",
            "longitude": "80.6305",
        },
        format="json",
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Kandy Goods Shed"
    assert (body["latitude"], body["longitude"]) == ("7.291900", "80.630500")
    assert body["active"] is True
    assert body["route_count"] == 0


def test_coordinates_are_optional(admin_api):
    response = admin_api.post(URL, {"name": "Hatton", "city": "Hatton"}, format="json")
    assert response.status_code == 201
    assert response.json()["latitude"] is None


def test_duplicate_stops_are_rejected_case_insensitively(admin_api):
    StopFactory(name="Kandy", city="Kandy")

    response = admin_api.post(URL, {"name": "KANDY", "city": "kandy"}, format="json")

    assert response.status_code == 400
    assert "name" in response.json()["error"]["details"]


@pytest.mark.parametrize(
    ("data", "field"),
    [
        ({"latitude": "95", "longitude": "80"}, "latitude"),
        ({"latitude": "7", "longitude": "181"}, "longitude"),
        ({"latitude": "7"}, "longitude"),
        ({"longitude": "80"}, "latitude"),
        ({"name": "x"}, "name"),
        ({"city": ""}, "city"),
    ],
)
def test_invalid_stops_are_rejected(admin_api, data, field):
    response = admin_api.post(URL, {"name": "Ella", "city": "Ella", **data}, format="json")

    assert response.status_code == 400
    assert field in response.json()["error"]["details"]


def test_search_and_filters(admin_api):
    StopFactory(name="Galle", city="Galle")
    StopFactory(name="Galle Face", city="Colombo", active=False)
    StopFactory(name="Jaffna", city="Jaffna")

    def names(**params):
        return sorted(s["name"] for s in admin_api.get(URL, params).json()["results"])

    assert names(search="galle") == ["Galle", "Galle Face"]
    assert names(active="false") == ["Galle Face"]
    assert names(city="Jaffna") == ["Jaffna"]


def test_cities_lists_every_distinct_city(admin_api):
    StopFactory(name="A", city="Kandy")
    StopFactory(name="B", city="Kandy")
    StopFactory(name="C", city="Galle")

    assert admin_api.get(f"{URL}cities/").json() == ["Galle", "Kandy"]


def test_update_and_deactivate(admin_api):
    stop = StopFactory(name="Old Name", city="Matara")

    updated = admin_api.patch(f"{URL}{stop.id}/", {"name": "Matara Bus Stand"}, format="json")
    deactivated = admin_api.post(f"{URL}{stop.id}/deactivate/")

    assert updated.json()["name"] == "Matara Bus Stand"
    assert deactivated.json()["active"] is False


def test_delete_unused_stop(admin_api):
    stop = StopFactory()

    assert admin_api.delete(f"{URL}{stop.id}/").status_code == 204
    assert not Stop.objects.filter(pk=stop.pk).exists()


def test_delete_is_blocked_while_a_route_uses_the_stop(admin_api):
    route = RouteFactory(name="Galle – Matara")
    middle = StopFactory(name="Weligama", city="Weligama")
    RouteStop.objects.create(route=route, stop=middle, sequence=2)

    for stop in (middle, route.origin):
        response = admin_api.delete(f"{URL}{stop.id}/")
        assert response.status_code == 409
        assert "Galle – Matara" in response.json()["error"]["message"]
