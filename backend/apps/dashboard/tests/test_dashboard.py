from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.tests.factories import (
    BusFactory,
    OperatorFactory,
    RouteFactory,
    TripFactory,
    create_seat_layout,
)
from apps.operators.models import OperatorStatus

pytestmark = pytest.mark.django_db

DASHBOARD_URL = "/api/v1/admin/dashboard/"

ADMIN_ENDPOINTS = [
    ("get", DASHBOARD_URL),
    ("get", "/api/v1/admin/activity/"),
    ("get", "/api/v1/admin/operators/"),
    ("post", "/api/v1/admin/operators/"),
    ("get", "/api/v1/admin/buses/"),
    ("post", "/api/v1/admin/buses/"),
    ("get", "/api/v1/admin/seat-layouts/"),
    ("post", "/api/v1/admin/seat-layouts/generate/"),
    ("get", "/api/v1/admin/routes/"),
    ("post", "/api/v1/admin/routes/"),
    ("get", "/api/v1/admin/stops/"),
    ("get", "/api/v1/admin/stops/cities/"),
    ("get", "/api/v1/admin/trips/"),
    ("post", "/api/v1/admin/trips/"),
    ("get", "/api/v1/admin/trip-schedules/"),
    ("post", "/api/v1/admin/trip-schedules/"),
]


@pytest.mark.parametrize(("method", "url"), ADMIN_ENDPOINTS)
def test_anonymous_requests_are_unauthorized(api_client, method, url):
    assert getattr(api_client, method)(url, {}, format="json").status_code == 401


@pytest.mark.parametrize("role_fixture", ["customer", "operator_user"])
@pytest.mark.parametrize(("method", "url"), ADMIN_ENDPOINTS)
def test_non_admin_roles_are_forbidden(request, authenticate, role_fixture, method, url):
    client = authenticate(request.getfixturevalue(role_fixture))

    response = getattr(client, method)(url, {}, format="json")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_dashboard_summarises_the_platform(admin_api):
    operator = OperatorFactory(status=OperatorStatus.ACTIVE)
    OperatorFactory(status=OperatorStatus.PENDING)
    OperatorFactory(status=OperatorStatus.SUSPENDED)
    bus = BusFactory(operator=operator)
    BusFactory(operator=operator, active=False)
    route = RouteFactory()
    RouteFactory(active=False)
    create_seat_layout()
    TripFactory(route=route, bus=bus, departure_datetime=timezone.now() + timedelta(days=2))
    TripFactory(route=route, bus=bus, departure_datetime=timezone.now() + timedelta(days=20))
    TripFactory(route=route, bus=bus, departure_datetime=timezone.now() - timedelta(days=1))

    body = admin_api.get(DASHBOARD_URL).json()

    assert body["buses"] == {"total": 2, "active": 1}
    assert body["routes"] == {"total": 2, "active": 1}
    assert body["operators"] == {"total": 3, "active": 1, "pending": 1, "suspended": 1}
    assert body["seat_layouts"] == {"total": 1, "active": 1}
    assert body["stops"]["total"] == 4
    assert (body["upcoming_trips"]["total"], body["upcoming_trips"]["next_7_days"]) == (2, 1)
    assert body["upcoming_trips"]["next"][0]["route_name"] == route.name


def test_recent_activity_lists_admin_changes_newest_first(admin_api, admin_user):
    operator_id = admin_api.post(
        "/api/v1/admin/operators/",
        {
            "company_name": "Activity Coaches",
            "registration_number": "PV-777",
            "contact_phone": "0112345678",
            "contact_email": "a@b.example",
            "address": "1 Main Street, Colombo",
        },
        format="json",
    ).json()["id"]
    admin_api.post(f"/api/v1/admin/operators/{operator_id}/activate/")

    activity = admin_api.get(DASHBOARD_URL).json()["recent_activity"]
    feed = admin_api.get("/api/v1/admin/activity/", {"entity_id": operator_id}).json()

    assert [a["action"] for a in activity] == ["activated", "created"]
    assert activity[0]["actor_email"] == admin_user.email
    assert activity[0]["entity_label"] == "Activity Coaches"
    assert feed["count"] == 2
