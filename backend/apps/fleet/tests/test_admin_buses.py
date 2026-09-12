import pytest

from apps.audit.models import ActivityLog
from apps.core.tests.factories import BusFactory, OperatorFactory, TripFactory, create_seat_layout
from apps.fleet.models import Bus
from apps.operators.models import OperatorStatus

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/buses/"


def payload(operator, **overrides):
    return {
        "operator": str(operator.id),
        "registration_number": "wp nb 1234",
        "name": "Coastal Express",
        "bus_type": "normal",
        "seat_capacity": 45,
        "facilities": ["usb_charging", "wifi", "wifi"],
        **overrides,
    }


def test_create_bus_normalises_registration_and_facilities(admin_api):
    operator = OperatorFactory()

    response = admin_api.post(URL, payload(operator), format="json")

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["registration_number"] == "WP NB-1234"
    assert body["facilities"] == ["wifi", "usb_charging"]
    assert body["operator_name"] == operator.company_name
    assert body["seat_layout"] is None
    assert body["trip_count"] == 0
    assert ActivityLog.objects.filter(entity_type="bus", action="created").exists()


@pytest.mark.parametrize("bus_type", ["ac", "luxury", "super_luxury"])
def test_air_conditioned_classes_always_list_the_ac_facility(admin_api, bus_type):
    response = admin_api.post(
        URL, payload(OperatorFactory(), bus_type=bus_type, facilities=["tv"]), format="json"
    )

    assert response.status_code == 201
    assert response.json()["facilities"] == ["ac", "tv"]


@pytest.mark.parametrize("attempt", ["nb 1234", "NB1234", "WP NB-1234", "sg nb-1234"])
def test_duplicate_registration_numbers_are_rejected_in_any_format(admin_api, attempt):
    existing = BusFactory(registration_number="NB-1234")

    response = admin_api.post(
        URL, payload(OperatorFactory(), registration_number=attempt), format="json"
    )

    assert response.status_code == 400
    message = response.json()["error"]["details"]["registration_number"][0]
    assert existing.operator.company_name in message


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("registration_number", "HELLO"),
        ("bus_type", "semi_luxury"),
        ("facilities", ["jacuzzi"]),
        ("seat_capacity", 0),
        ("seat_capacity", 91),
        ("name", " "),
    ],
)
def test_invalid_values_are_rejected(admin_api, field, value):
    response = admin_api.post(URL, payload(OperatorFactory(), **{field: value}), format="json")

    assert response.status_code == 400
    assert field in response.json()["error"]["details"]


def test_capacity_cannot_exceed_the_layouts_bookable_seats(admin_api):
    layout = create_seat_layout("2x1", passenger_rows=5)  # 4 rows x 3 + back row of 4 = 16
    operator = OperatorFactory()

    too_many = admin_api.post(
        URL, payload(operator, seat_layout=str(layout.id), seat_capacity=17), format="json"
    )
    exact = admin_api.post(
        URL, payload(operator, seat_layout=str(layout.id), seat_capacity=16), format="json"
    )

    assert too_many.status_code == 400
    assert "16 bookable seats" in too_many.json()["error"]["details"]["seat_capacity"][0]
    assert exact.status_code == 201
    assert exact.json()["seat_layout_name"] == layout.name


def test_buses_cannot_be_assigned_to_a_suspended_operator(admin_api):
    operator = OperatorFactory(status=OperatorStatus.SUSPENDED)

    response = admin_api.post(URL, payload(operator), format="json")

    assert response.status_code == 400
    assert "operator" in response.json()["error"]["details"]


def test_inactive_layouts_cannot_be_assigned(admin_api):
    layout = create_seat_layout(active=False)

    response = admin_api.post(
        URL, payload(OperatorFactory(), seat_layout=str(layout.id), seat_capacity=40), format="json"
    )

    assert response.status_code == 400
    assert "seat_layout" in response.json()["error"]["details"]


def test_reassigning_a_bus_to_another_operator(admin_api):
    bus = BusFactory()
    new_operator = OperatorFactory()

    response = admin_api.patch(f"{URL}{bus.id}/", {"operator": str(new_operator.id)}, format="json")

    assert response.status_code == 200
    assert response.json()["operator"] == str(new_operator.id)
    assert ActivityLog.objects.get(action="updated").changes == {"fields": ["operator"]}


def test_filters_and_search(admin_api):
    operator = OperatorFactory()
    BusFactory(operator=operator, name="Wifi Cruiser", facilities=["wifi"], bus_type="ac")
    BusFactory(operator=operator, name="Plain Runner", active=False)
    BusFactory(name="Other Operator Bus")

    def names(**params):
        return sorted(b["name"] for b in admin_api.get(URL, params).json()["results"])

    assert names(facility="wifi") == ["Wifi Cruiser"]
    assert names(bus_type="ac") == ["Wifi Cruiser"]
    assert names(active="false") == ["Plain Runner"]
    assert names(operator=str(operator.id)) == ["Plain Runner", "Wifi Cruiser"]
    assert names(search="cruis") == ["Wifi Cruiser"]


def test_activate_and_deactivate(admin_api):
    bus = BusFactory(active=True)

    assert admin_api.post(f"{URL}{bus.id}/deactivate/").json()["active"] is False
    assert admin_api.post(f"{URL}{bus.id}/activate/").json()["active"] is True


def test_delete_bus_without_trips(admin_api):
    bus = BusFactory()

    assert admin_api.delete(f"{URL}{bus.id}/").status_code == 204
    assert not Bus.objects.filter(pk=bus.pk).exists()


def test_delete_is_blocked_when_the_bus_has_trips(admin_api):
    trip = TripFactory()

    response = admin_api.delete(f"{URL}{trip.bus_id}/")

    assert response.status_code == 409
    assert "Deactivate" in response.json()["error"]["message"]
