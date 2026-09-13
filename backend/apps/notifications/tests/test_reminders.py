"""A text a few hours before the bus leaves — for people who booked ahead, and only once."""

from datetime import timedelta

import pytest
from django.test import override_settings

from apps.bookings.models import Booking
from apps.bookings.services import cancel_booking
from apps.notifications import sms
from apps.notifications.models import Notification, NotificationKind, NotificationStatus
from apps.notifications.services import deliver_due, queue_trip_reminders
from apps.trips.models import TripStatus

from .conftest import book, confirm_at_counter, texts_to

pytestmark = pytest.mark.django_db


def departure(booking: Booking):
    return booking.boarding_time


def reminders():
    return Notification.objects.filter(kind=NotificationKind.TRIP_REMINDER)


@pytest.fixture
def paid(trip, alice, staff) -> Booking:
    """Booked and paid days before the bus leaves (its ticket already sent)."""
    booking = confirm_at_counter(staff, book(alice, trip, "15"))
    deliver_due()
    sms.outbox.clear()
    return booking


class TestReminders:
    def test_a_passenger_is_reminded_three_hours_before_the_bus_leaves(self, paid, alice):
        two_hours_before = departure(paid) - timedelta(hours=2)

        assert queue_trip_reminders(now=two_hours_before) == 1
        deliver_due(now=two_hours_before)

        text = texts_to(alice.phone)[0]
        assert "reminder: your bus to Batticaloa leaves Colombo at 8:30 PM" in text
        assert paid.booking_reference in text
        assert "Seat 15" in text and "Bus WP NC-4521" in text
        assert paid.ticket.share_url in text
        # Both phones on the booking hear about it.
        assert {message["to"] for message in sms.outbox} == {alice.phone, "+94771234567"}

    def test_the_reminder_says_today_or_tomorrow(self, paid):
        late_the_night_before = departure(paid) - timedelta(hours=2, minutes=45)
        queue_trip_reminders(now=late_the_night_before)

        body = reminders().first().body
        assert "8:30 PM today" in body or "8:30 PM tomorrow" in body

    def test_nobody_is_reminded_before_the_window_opens(self, paid):
        assert queue_trip_reminders(now=departure(paid) - timedelta(hours=4)) == 0
        assert not reminders().exists()

    def test_nobody_is_reminded_once_the_bus_has_left(self, paid):
        assert queue_trip_reminders(now=departure(paid) + timedelta(minutes=1)) == 0

    def test_running_it_again_reminds_nobody_twice(self, paid):
        moment = departure(paid) - timedelta(hours=2)
        queue_trip_reminders(now=moment)
        queue_trip_reminders(now=moment + timedelta(minutes=1))

        assert reminders().count() == 2  # one per phone, not per run

    def test_someone_who_booked_inside_the_window_is_not_reminded(self, paid):
        # They booked an hour before departure: their ticket has only just arrived.
        Booking.objects.filter(pk=paid.pk).update(confirmed_at=departure(paid) - timedelta(hours=1))

        assert queue_trip_reminders(now=departure(paid) - timedelta(minutes=30)) == 0

    def test_unpaid_and_cancelled_bookings_are_not_reminded(self, paid, trip, bob, staff):
        book(bob, trip, "20")  # never paid
        cancel_booking(paid, reason="", allow_paid=True, actor=staff)

        assert queue_trip_reminders(now=departure(paid) - timedelta(hours=2)) == 0

    def test_a_cancelled_trip_sends_no_reminder(self, paid, trip):
        type(trip).objects.filter(pk=trip.pk).update(status=TripStatus.CANCELLED)

        assert queue_trip_reminders(now=departure(paid) - timedelta(hours=2)) == 0

    def test_a_reminder_queued_for_a_booking_cancelled_since_is_not_sent(self, paid, staff):
        moment = departure(paid) - timedelta(hours=2)
        queue_trip_reminders(now=moment)
        cancel_booking(paid, reason="", allow_paid=True, actor=staff)

        deliver_due(now=moment)

        assert sms.outbox == []
        assert set(reminders().values_list("status", flat=True)) == {NotificationStatus.SKIPPED}

    @override_settings(NOTIFICATIONS={"DELIVERY": "inline", "REMINDER_HOURS_BEFORE": 0})
    def test_reminders_can_be_switched_off(self, paid):
        assert queue_trip_reminders(now=departure(paid) - timedelta(hours=2)) == 0
