from datetime import timedelta

import pytest
from django.utils import timezone

from apps.audit.models import ActivityLog
from apps.trips.models import Trip, TripSchedule

from .conftest import local_datetime

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/trip-schedules/"


def day(offset: int) -> str:
    return (timezone.localdate() + timedelta(days=offset)).isoformat()


def schedule_payload(route, bus, **overrides):
    return {
        "route": str(route.id),
        "bus": str(bus.id),
        "departure_time": "20:30",
        "recurrence": "daily",
        "start_date": day(1),
        "end_date": day(60),
        **overrides,
    }


def create_schedule(admin_api, route, bus, **overrides):
    response = admin_api.post(URL, schedule_payload(route, bus, **overrides), format="json")
    assert response.status_code == 201, response.content
    return response.json()


def generate(admin_api, schedule_id, start, end, *, dry_run=False):
    return admin_api.post(
        f"{URL}{schedule_id}/generate/",
        {"from_date": day(start), "to_date": day(end), "dry_run": dry_run},
        format="json",
    )


def test_create_daily_schedule(admin_api, route, bus):
    body = create_schedule(admin_api, route, bus)

    assert body["base_price"] == "2500.00"  # the route's fare
    assert body["operator"] == str(bus.operator_id)
    assert (body["recurrence"], body["weekdays"]) == ("daily", [])
    assert body["departure_time"] == "20:30:00"
    assert body["duration_minutes"] == 540


def test_weekly_schedule_needs_weekdays_and_normalises_them(admin_api, route, bus):
    missing = admin_api.post(URL, schedule_payload(route, bus, recurrence="weekly"), format="json")
    body = create_schedule(admin_api, route, bus, recurrence="weekly", weekdays=[4, 0, 4])

    assert missing.status_code == 400
    assert "weekdays" in missing.json()["error"]["details"]
    assert body["weekdays"] == [0, 4]


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"end_date": day(0), "start_date": day(5)}, "end_date"),
        ({"end_date": day(500)}, "end_date"),
        ({"recurrence": "weekly", "weekdays": [7]}, "weekdays"),
        ({"recurrence": "monthly"}, "recurrence"),
        ({"base_price": "-5"}, "base_price"),
        ({"departure_time": "25:00"}, "departure_time"),
    ],
)
def test_invalid_schedules(admin_api, route, bus, overrides, field):
    response = admin_api.post(URL, schedule_payload(route, bus, **overrides), format="json")

    assert response.status_code == 400
    assert field in response.json()["error"]["details"]


def test_preview_creates_nothing(admin_api, route, bus):
    schedule = create_schedule(admin_api, route, bus)

    body = generate(admin_api, schedule["id"], 1, 7, dry_run=True).json()

    assert (body["planned"], body["created"]) == (7, 0)
    assert {o["result"] for o in body["occurrences"]} == {"planned"}
    assert not Trip.objects.exists()


def test_generate_creates_trips_and_is_idempotent(admin_api, route, bus):
    schedule = create_schedule(admin_api, route, bus)

    first = generate(admin_api, schedule["id"], 1, 7).json()
    second = generate(admin_api, schedule["id"], 1, 7).json()

    assert first["created"] == 7
    assert (second["created"], second["skipped"]) == (0, 7)
    assert {o["result"] for o in second["occurrences"]} == {"exists"}
    trips = Trip.objects.filter(schedule_id=schedule["id"])
    assert trips.count() == 7
    assert all(trip.trip_stops.count() == 5 for trip in trips)
    assert TripSchedule.objects.get(pk=schedule["id"]).last_generated_until.isoformat() == day(7)
    assert ActivityLog.objects.filter(action="generated").count() == 1


def test_coverage_advances_even_when_the_days_already_exist(admin_api, route, bus):
    schedule = create_schedule(admin_api, route, bus)
    generate(admin_api, schedule["id"], 1, 3)
    TripSchedule.objects.filter(pk=schedule["id"]).update(last_generated_until=None)

    generate(admin_api, schedule["id"], 1, 3)  # nothing new to create
    generate(admin_api, schedule["id"], 1, 10, dry_run=True)  # previews never count

    assert TripSchedule.objects.get(pk=schedule["id"]).last_generated_until.isoformat() == day(3)


def test_weekly_schedules_only_run_on_their_days(admin_api, route, bus):
    wanted = [(timezone.localdate() + timedelta(days=1)).weekday()]
    schedule = create_schedule(admin_api, route, bus, recurrence="weekly", weekdays=wanted)

    body = generate(admin_api, schedule["id"], 1, 14).json()

    assert body["created"] == 2
    assert all(
        timezone.localtime(trip.departure_datetime).weekday() == wanted[0]
        for trip in Trip.objects.all()
    )


def test_generation_skips_slots_where_the_bus_is_busy(admin_api, route, bus):
    admin_api.post(
        "/api/v1/admin/trips/",
        {
            "route": str(route.id),
            "bus": str(bus.id),
            "departure_datetime": local_datetime(2, 18).isoformat(),
        },
        format="json",
    )
    schedule = create_schedule(admin_api, route, bus)

    body = generate(admin_api, schedule["id"], 1, 3).json()

    results = [o["result"] for o in body["occurrences"]]
    assert results == ["created", "conflict", "created"]
    assert "already running" in body["occurrences"][1]["detail"]


def test_generation_respects_the_schedule_window(admin_api, route, bus):
    schedule = create_schedule(admin_api, route, bus, start_date=day(3), end_date=day(5))

    body = generate(admin_api, schedule["id"], 1, 10).json()

    assert body["created"] == 3


def test_generation_limits(admin_api, route, bus):
    schedule = create_schedule(admin_api, route, bus)
    admin_api.post(f"{URL}{schedule['id']}/deactivate/")

    too_long = generate(admin_api, schedule["id"], 1, 120)
    inactive = generate(admin_api, schedule["id"], 1, 3)

    assert too_long.status_code == 400
    assert inactive.status_code == 400


def test_deleting_a_schedule_keeps_its_trips(admin_api, route, bus):
    schedule = create_schedule(admin_api, route, bus)
    generate(admin_api, schedule["id"], 1, 2)

    assert admin_api.delete(f"{URL}{schedule['id']}/").status_code == 204
    assert Trip.objects.count() == 2
    assert not Trip.objects.exclude(schedule=None).exists()


def test_trips_can_be_listed_by_schedule(admin_api, route, bus):
    schedule = create_schedule(admin_api, route, bus)
    generate(admin_api, schedule["id"], 1, 3)

    body = admin_api.get("/api/v1/admin/trips/", {"schedule": schedule["id"]}).json()
    listed = admin_api.get(URL).json()["results"][0]

    assert body["count"] == 3
    assert (listed["trip_count"], listed["upcoming_trip_count"]) == (3, 3)
