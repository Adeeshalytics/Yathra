import pytest
from django.core import mail

from apps.bookings.models import Booking
from apps.bookings.tests.conftest import (  # noqa: F401 — shared fixtures
    BOOKINGS,
    alice,
    bob,
    bus,
    client_for,
    hold_and_book,
    passenger,
    route,
    staff,
    trip,
)
from apps.notifications import sms


@pytest.fixture(autouse=True)
def outboxes():
    """Every test starts with empty SMS and e-mail outboxes."""
    sms.outbox.clear()
    mail.outbox.clear()
    yield
    sms.outbox.clear()


def book(customer, on_trip, *seats, passengers=None) -> Booking:
    response = hold_and_book(client_for(customer), on_trip, *seats, passengers=passengers)
    assert response.status_code == 201, response.content
    return Booking.objects.get(pk=response.json()["id"])


def confirm_at_counter(staff_user, booking: Booking) -> Booking:
    """Paid in cash: the quickest way to a confirmed booking (and its ticket)."""
    response = client_for(staff_user).post(f"{BOOKINGS}{booking.pk}/confirm/")
    assert response.status_code == 200, response.content
    booking.refresh_from_db()
    return booking


def texts_to(number: str) -> list[str]:
    return [message["text"] for message in sms.outbox if message["to"] == number]
