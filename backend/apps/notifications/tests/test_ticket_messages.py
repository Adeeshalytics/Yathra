"""
The e-ticket arrives by SMS and e-mail the moment a booking is paid — once, to everyone on it.
"""

import io
from datetime import timedelta

import pytest
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from apps.bookings.services import cancel_booking
from apps.notifications import sms
from apps.notifications.models import Notification, NotificationKind, NotificationStatus
from apps.notifications.services import deliver_due, notify_booking_confirmed
from apps.notifications.sms import LocmemBackend, SmsError
from apps.notifications.text import is_gsm, sms_parts
from apps.payments.tests.conftest import notify, start

from .conftest import book, confirm_at_counter, passenger, texts_to

pytestmark = pytest.mark.django_db


def two_passengers():
    return [
        passenger("15", "Kasuni Fernando"),
        {**passenger("16", "Ravi Fernando"), "phone": "071 555 0101", "email": ""},
    ]


class TestTheTicketIsSentWhenABookingIsPaid:
    def test_everyone_on_the_booking_gets_a_text_and_an_email(
        self, trip, alice, staff, django_capture_on_commit_callbacks
    ):
        booking = book(alice, trip, "15", "16", passengers=two_passengers())

        with django_capture_on_commit_callbacks(execute=True):
            confirm_at_counter(staff, booking)

        # The account holder, then each passenger's own number — each number once.
        assert [message["to"] for message in sms.outbox] == [
            alice.phone,
            "+94771234567",
            "+94715550101",
        ]
        # The account's e-mail and the one passenger who gave an address.
        assert sorted(email.to[0] for email in mail.outbox) == sorted(
            [alice.email, "seat15@example.com"]
        )
        assert set(
            Notification.objects.filter(booking=booking).values_list("status", flat=True)
        ) == {NotificationStatus.SENT}

    def test_the_text_holds_what_a_passenger_needs_at_the_bus_door(
        self, trip, alice, staff, django_capture_on_commit_callbacks
    ):
        booking = book(alice, trip, "15", "16")
        with django_capture_on_commit_callbacks(execute=True):
            confirm_at_counter(staff, booking)

        text = texts_to(alice.phone)[0]
        ticket = booking.ticket
        assert booking.booking_reference in text
        assert "Colombo to Batticaloa" in text
        assert "Board at Colombo, 8:30 PM" in text
        assert "Seats 15, 16" in text
        assert "Bus WP NC-4521" in text
        assert f"http://localhost:3000/t/{ticket.share_code}" in text
        # Plain GSM text, so it isn't billed as three times as many parts.
        assert is_gsm(text)
        assert sms_parts(text) <= 2

    def test_the_email_attaches_the_ticket_and_links_to_it(
        self, trip, alice, staff, django_capture_on_commit_callbacks
    ):
        booking = book(alice, trip, "15")
        with django_capture_on_commit_callbacks(execute=True):
            confirm_at_counter(staff, booking)

        email = next(e for e in mail.outbox if e.to == [alice.email])
        assert booking.booking_reference in email.subject
        assert "Colombo to Batticaloa" in email.subject
        assert booking.ticket.share_url in email.body
        html, mimetype = email.alternatives[0]
        assert mimetype == "text/html" and booking.ticket.share_url in html
        name, content, attachment_type = email.attachments[0]
        assert name.endswith(f"{booking.booking_reference}.pdf")
        assert attachment_type == "application/pdf" and content.startswith(b"%PDF")

    def test_a_payment_notification_delivered_twice_sends_one_ticket(
        self, trip, alice, django_capture_on_commit_callbacks
    ):
        from apps.bookings.tests.conftest import client_for

        _, payment = start(client_for(alice), trip, "15")

        with django_capture_on_commit_callbacks(execute=True):
            assert notify(payment, event_id="evt-1").status_code == 200
            assert notify(payment, event_id="evt-1").status_code == 200
            assert notify(payment, event_id="evt-2").status_code == 200

        assert len(texts_to(alice.phone)) == 1
        assert Notification.objects.filter(kind=NotificationKind.TICKET).count() == len(
            sms.outbox
        ) + len(mail.outbox)

    def test_confirming_again_queues_nothing_new(self, trip, alice, staff):
        booking = confirm_at_counter(staff, book(alice, trip, "15"))
        before = Notification.objects.count()

        assert notify_booking_confirmed(booking) == []
        assert Notification.objects.count() == before

    def test_messages_wait_for_the_confirmation_to_be_saved(self, trip, alice, staff):
        # Without the commit hooks running, the messages are only written down…
        booking = confirm_at_counter(staff, book(alice, trip, "15"))
        assert sms.outbox == [] and mail.outbox == []
        assert set(
            Notification.objects.filter(booking=booking).values_list("status", flat=True)
        ) == {NotificationStatus.PENDING}

        # …and the worker sends whatever is waiting.
        output = io.StringIO()
        call_command("send_notifications", "--skip-reminders", stdout=output)

        assert texts_to(alice.phone)
        assert len(mail.outbox) == 2
        assert "Sent 4" in output.getvalue()  # two texts, two e-mails

    def test_a_booking_cancelled_before_its_ticket_went_out_is_not_texted(self, trip, alice, staff):
        booking = confirm_at_counter(staff, book(alice, trip, "15"))
        cancel_booking(booking, reason="Changed plans", allow_paid=True, actor=staff)

        outcome = deliver_due()

        assert sms.outbox == [] and mail.outbox == []
        assert outcome[NotificationStatus.SKIPPED] == Notification.objects.count()
        assert Notification.objects.filter(
            last_error="The booking is no longer confirmed."
        ).exists()


class TestSwitchedOffChannels:
    @override_settings(SMS={"BACKEND": ""})
    def test_with_texts_switched_off_the_booking_records_why_nothing_was_texted(
        self, trip, alice, staff, django_capture_on_commit_callbacks
    ):
        booking = book(alice, trip, "15")
        with django_capture_on_commit_callbacks(execute=True):
            confirm_at_counter(staff, booking)

        texts = Notification.objects.filter(booking=booking, channel="sms")
        assert {n.status for n in texts} == {NotificationStatus.SKIPPED}
        assert texts.first().last_error == "Text messages are switched off."
        assert len(mail.outbox) == 2  # e-mail still goes

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.dummy.EmailBackend")
    def test_with_email_switched_off_only_texts_go(
        self, trip, alice, staff, django_capture_on_commit_callbacks
    ):
        booking = book(alice, trip, "15")
        with django_capture_on_commit_callbacks(execute=True):
            confirm_at_counter(staff, booking)

        emails = Notification.objects.filter(booking=booking, channel="email")
        assert {n.status for n in emails} == {NotificationStatus.SKIPPED}
        assert texts_to(alice.phone)


class TestFailedMessagesAreRetried:
    def test_a_gateway_hiccup_is_tried_again_later(self, trip, alice, staff, monkeypatch):
        confirm_at_counter(staff, book(alice, trip, "15"))
        text = Notification.objects.filter(channel="sms").first()

        def down(self, to, body):
            raise SmsError("Couldn't reach the gateway.")

        monkeypatch.setattr(LocmemBackend, "send", down)
        deliver_due(ids=[text.pk])
        text.refresh_from_db()
        assert (text.status, text.attempts) == (NotificationStatus.PENDING, 1)
        assert text.next_attempt_at > timezone.now() + timedelta(seconds=50)
        assert text.last_error == "Couldn't reach the gateway."

        # Not due yet: nothing happens.
        monkeypatch.undo()
        assert deliver_due(ids=[text.pk]) == {}
        # A minute later it goes through.
        deliver_due(ids=[text.pk], now=timezone.now() + timedelta(minutes=2))
        text.refresh_from_db()
        assert (text.status, text.attempts, text.last_error) == (NotificationStatus.SENT, 2, "")

    def test_a_refusal_is_not_retried(self, trip, alice, staff, monkeypatch):
        confirm_at_counter(staff, book(alice, trip, "15"))

        def refuse(self, to, body):
            raise SmsError("Invalid number.", retryable=False)

        monkeypatch.setattr(LocmemBackend, "send", refuse)
        deliver_due()

        texts = Notification.objects.filter(channel="sms")
        assert {n.status for n in texts} == {NotificationStatus.FAILED}

    def test_it_gives_up_after_the_last_attempt(self, trip, alice, staff, monkeypatch):
        confirm_at_counter(staff, book(alice, trip, "15"))
        text = Notification.objects.filter(channel="sms").first()

        def down(self, to, body):
            raise SmsError("down")

        monkeypatch.setattr(LocmemBackend, "send", down)

        later = timezone.now()
        for _ in range(5):
            later += timedelta(hours=2)
            deliver_due(ids=[text.pk], now=later)

        text.refresh_from_db()
        assert (text.status, text.attempts) == (NotificationStatus.FAILED, 5)

    def test_a_broken_mail_server_is_retried(self, trip, alice, staff, monkeypatch):
        confirm_at_counter(staff, book(alice, trip, "15"))

        def broken(*args, **kwargs):
            raise OSError("Connection refused")

        monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", broken)
        deliver_due()

        email = Notification.objects.filter(channel="email").first()
        assert email.status == NotificationStatus.PENDING
        assert "Connection refused" in email.last_error

    def test_a_message_claimed_by_another_sender_is_left_alone(self, trip, alice, staff):
        confirm_at_counter(staff, book(alice, trip, "15"))
        Notification.objects.update(
            status=NotificationStatus.SENDING, locked_until=timezone.now() + timedelta(minutes=5)
        )

        assert deliver_due() == {}
        assert sms.outbox == []

    def test_a_sender_that_died_mid_way_is_taken_over(self, trip, alice, staff):
        confirm_at_counter(staff, book(alice, trip, "15"))
        Notification.objects.update(
            status=NotificationStatus.SENDING, locked_until=timezone.now() - timedelta(seconds=1)
        )

        deliver_due()

        assert texts_to(alice.phone)
        assert set(Notification.objects.values_list("status", flat=True)) == {
            NotificationStatus.SENT
        }
