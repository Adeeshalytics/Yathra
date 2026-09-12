"""
Real races on committed transactions: a gateway notification arriving twice at the same instant,
or racing a status check, still confirms the booking exactly once.
"""

import pytest

from apps.bookings.models import Booking
from apps.bookings.services import create_booking, lock_seats
from apps.bookings.tests.conftest import build_trip
from apps.bookings.tests.test_concurrency import race
from apps.core.tests.factories import CustomerFactory
from apps.payments.models import EventOutcome, PaymentEvent, PaymentStatus
from apps.payments.providers.mock import MockProvider
from apps.payments.services import process_notification, reconcile, start_payment
from apps.tickets.models import Ticket

pytestmark = pytest.mark.django_db(transaction=True)


def open_payment():
    trip = build_trip()
    customer = CustomerFactory()
    lock_seats(trip_id=trip.pk, customer=customer, seat_numbers=["15"])
    stops = {stop.stop.name: stop.stop_id for stop in trip.trip_stops.select_related("stop")}
    booking = create_booking(
        customer=customer,
        trip_id=trip.pk,
        boarding_stop_id=stops["Colombo"],
        dropoff_stop_id=stops["Batticaloa"],
        passengers=[{"seat_number": "15", "name": "A", "phone": "+94771234567", "email": "a@x.lk"}],
    )
    payment, _ = start_payment(booking, provider_code="mock")
    return booking, payment


def assert_confirmed_once(booking):
    booking.refresh_from_db()
    assert booking.status == "confirmed"
    assert Ticket.objects.filter(booking=booking).count() == 1
    assert booking.payments.get().status == PaymentStatus.SUCCESSFUL
    applied = PaymentEvent.objects.filter(outcome=EventOutcome.APPLIED, status="successful")
    assert applied.count() == 1


def test_the_same_notification_arriving_twice_at_once():
    booking, payment = open_payment()
    provider = MockProvider()
    body, headers = provider.notification(provider.record(payment, status="succeeded"))

    def deliver():
        return process_notification("mock", body=body, headers=headers, data={})

    outcomes = race([deliver, deliver])

    assert sorted(outcomes) == ["applied", "duplicate"]
    assert_confirmed_once(booking)


def test_a_notification_racing_a_status_check():
    booking, payment = open_payment()
    provider = MockProvider()
    body, headers = provider.notification(provider.record(payment, status="succeeded"))

    outcomes = race(
        [
            lambda: process_notification("mock", body=body, headers=headers, data={}),
            lambda: reconcile(payment),
        ]
    )

    assert sorted(outcomes) == ["applied", "ignored"]
    assert_confirmed_once(booking)
    assert Booking.objects.get(pk=booking.pk).confirmed_at is not None
