import pytest

from apps.audit.models import ActivityLog
from apps.core.tests.factories import BusFactory, OperatorFactory, OperatorMembershipFactory
from apps.operators.models import Operator, OperatorStatus

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/operators/"


def payload(**overrides):
    return {
        "company_name": "  Sunrise   Travels ",
        "registration_number": "pv-123456",
        "contact_phone": "077 123 4567",
        "contact_email": "Ops@Sunrise.example",
        "address": "12 Temple Road, Galle",
        **overrides,
    }


def test_create_operator_normalises_input_and_logs_activity(admin_api):
    response = admin_api.post(URL, payload(), format="json")

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["company_name"] == "Sunrise Travels"
    assert body["registration_number"] == "PV-123456"
    assert body["contact_phone"] == "+94771234567"
    assert body["contact_email"] == "ops@sunrise.example"
    assert body["status"] == OperatorStatus.PENDING
    assert body["bus_count"] == 0
    assert ActivityLog.objects.filter(
        action="created", entity_type="operator", entity_id=body["id"]
    ).exists()


def test_duplicate_registration_number_is_rejected_case_insensitively(admin_api):
    OperatorFactory(registration_number="PV-123456")

    response = admin_api.post(URL, payload(registration_number=" pv-123456 "), format="json")

    assert response.status_code == 400
    assert "registration_number" in response.json()["error"]["details"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("contact_phone", "123"),
        ("contact_email", "not-an-email"),
        ("company_name", " "),
        ("address", "x"),
        ("registration_number", "#!"),
        ("status", "closed"),
    ],
)
def test_invalid_fields_are_rejected(admin_api, field, value):
    response = admin_api.post(URL, payload(**{field: value}), format="json")

    assert response.status_code == 400
    assert field in response.json()["error"]["details"]


def test_retrieve_includes_fleet_and_staff_counts(admin_api):
    operator = OperatorFactory()
    BusFactory(operator=operator)
    BusFactory(operator=operator, active=False)
    OperatorMembershipFactory(operator=operator)

    body = admin_api.get(f"{URL}{operator.id}/").json()

    assert (body["bus_count"], body["active_bus_count"], body["member_count"]) == (2, 1, 1)


def test_update_records_only_changed_fields(admin_api):
    operator = OperatorFactory()

    response = admin_api.patch(
        f"{URL}{operator.id}/",
        {"company_name": "Renamed Coaches", "contact_email": operator.contact_email},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["company_name"] == "Renamed Coaches"
    log = ActivityLog.objects.get(action="updated")
    assert log.changes == {"fields": ["company_name"]}


def test_activate_and_deactivate(admin_api):
    operator = OperatorFactory(status=OperatorStatus.PENDING)

    activated = admin_api.post(f"{URL}{operator.id}/activate/")
    deactivated = admin_api.post(f"{URL}{operator.id}/deactivate/")

    assert activated.json()["status"] == OperatorStatus.ACTIVE
    assert deactivated.json()["status"] == OperatorStatus.SUSPENDED
    assert list(ActivityLog.objects.values_list("action", flat=True).order_by("created_at")) == [
        "activated",
        "deactivated",
    ]


def test_search_filter_and_ordering(admin_api):
    OperatorFactory(company_name="Ruhuna Travels", status=OperatorStatus.ACTIVE)
    OperatorFactory(company_name="Kandy Coaches", status=OperatorStatus.SUSPENDED)
    OperatorFactory(company_name="Anuradha Lines", status=OperatorStatus.ACTIVE)

    searched = admin_api.get(URL, {"search": "ruhuna"}).json()
    filtered = admin_api.get(URL, {"status": "suspended"}).json()
    ordered = admin_api.get(URL, {"ordering": "-company_name"}).json()

    assert [o["company_name"] for o in searched["results"]] == ["Ruhuna Travels"]
    assert [o["company_name"] for o in filtered["results"]] == ["Kandy Coaches"]
    assert ordered["results"][0]["company_name"] == "Ruhuna Travels"


def test_list_is_paginated(admin_api):
    OperatorFactory.create_batch(3)

    body = admin_api.get(URL, {"page_size": 2}).json()

    assert (body["count"], body["total_pages"], len(body["results"])) == (3, 2, 2)


def test_delete_operator_without_buses(admin_api):
    operator = OperatorFactory()

    response = admin_api.delete(f"{URL}{operator.id}/")

    assert response.status_code == 204
    assert not Operator.objects.filter(pk=operator.pk).exists()
    assert ActivityLog.objects.filter(action="deleted", entity_id=str(operator.pk)).exists()


def test_delete_is_blocked_while_operator_has_buses(admin_api):
    bus = BusFactory()

    response = admin_api.delete(f"{URL}{bus.operator_id}/")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    assert "bus" in response.json()["error"]["message"]
    assert Operator.objects.filter(pk=bus.operator_id).exists()


def test_unknown_operator_is_404(admin_api):
    response = admin_api.get(f"{URL}00000000-0000-0000-0000-000000000000/")
    assert response.status_code == 404
