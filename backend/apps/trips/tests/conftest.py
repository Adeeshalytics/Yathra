from datetime import datetime, time, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.core.tests.factories import create_bookable_bus, create_route_with_stops

# The example journey: Colombo 20:30 → Kadawatha 21:00 → Kurunegala 22:30 → Dambulla 00:30
# → Batticaloa 05:30 (next day).
BATTICALOA_PLAN = (
    ("Colombo", 0, 0),
    ("Kadawatha", 30, 30),
    ("Kurunegala", 120, 125),
    ("Dambulla", 240, 245),
    ("Batticaloa", 540, 540),
)


def local_datetime(days_ahead: int, hour: int, minute: int = 0) -> datetime:
    day = timezone.localdate() + timedelta(days=days_ahead)
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


def iso(moment: datetime) -> str:
    return timezone.localtime(moment).isoformat()


@pytest.fixture
def route(db):
    return create_route_with_stops(
        "Colombo – Batticaloa", BATTICALOA_PLAN, base_fare=Decimal("2500.00")
    )


@pytest.fixture
def bus(db):
    return create_bookable_bus(registration_number="WP-NC-4521", name="Batticaloa Night Express")
