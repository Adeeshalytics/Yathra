"""The gateway's verified word — and only that — confirms a booking, exactly once."""

from datetime import timedelta
from unittest import mock

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.bookings import services as booking_services
from apps.bookings.models import Booking, Passenger
from apps.payments.models import EventOutcome, Payment, PaymentEvent, PaymentStatus
from apps.payments.providers.mock import MockProvider
from apps.tickets.models import Ticket

from .conftest import (
    PAYMENTS,
    booking_url,
    client_for,
    deliver,
    expire_bookings,
    lock,
    notify,
    signed,
    start,
)

pytestmark = pytest.mark.django_db


def booking_of(payment: Payment) -> Booking:
    return Booking.objects.get(pk=payment.booking_id)


class TestSuccessfulPayment:
    def test_a_verified_notification_confirms_the_booking_and_issues_the_ticket(
        self, trip, alice, bob
    ):
        client = client_for(alice)
        booking, payment = start(client, trip, "15", "16")

        response = notify(payment, method="mobile_wallet")

        assert response.status_code == 200
        assert response.json() == {"received": True, "outcome": "applied"}
        payment.refresh_from_db()
        assert payment.status == PaymentStatus.SUCCESSFUL
        assert payment.payment_method == "mobile_wallet"
        assert payment.provider_reference.startswith("MOCK")
        assert payment.paid_at is not None
        assert not payment.requires_refund
        confirmed = booking_of(payment)
        assert (confirmed.status, confirmed.confirmed_at is not None) == ("confirmed", True)
        assert Ticket.objects.get(booking=confirmed).ticket_number.startswith("TK")
        assert lock(client_for(bob), trip, "15").status_code == 409
        detail = client.get(booking_url(booking)).json()
        assert detail["ticket"]["status"] == "valid"
        assert detail["payment"]["status"] == "successful"

    def test_the_browser_coming_back_confirms_nothing(self, trip, alice):
        client = client_for(alice)
        _, payment = start(client, trip)

        # The customer lands on the "payment" page, which polls and asks us to verify. The
        # gateway has no record of a payment, so nothing changes.
        polled = client.get(f"{PAYMENTS}{payment.pk}/").json()
        verified = client.post(f"{PAYMENTS}{payment.pk}/verify/").json()

        assert polled["status"] == verified["status"] == "pending"
        assert booking_of(payment).status == "payment_pending"
        assert not Ticket.objects.exists()


class TestIdempotency:
    def test_a_notification_delivered_twice_is_applied_once(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        body, headers = signed(payment)

        first = deliver(body, headers)
        confirmed_at = booking_of(payment).confirmed_at
        second = deliver(body, headers)

        assert (first.json()["outcome"], second.json()["outcome"]) == ("applied", "duplicate")
        assert second.status_code == 200  # so the gateway stops retrying
        assert booking_of(payment).confirmed_at == confirmed_at
        assert Ticket.objects.count() == 1
        assert PaymentEvent.objects.filter(source="webhook").count() == 1

    def test_a_second_success_notification_changes_nothing(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        notify(payment)

        again = notify(payment)  # a different event id: e.g. the gateway's own resend

        assert again.json()["outcome"] == EventOutcome.IGNORED
        assert Ticket.objects.count() == 1
        assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.SUCCESSFUL

    def test_a_retry_after_our_server_failed_is_processed(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        body, headers = signed(payment)
        real = booking_services.settle_payment
        calls = []

        def flaky(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("database hiccup")
            return real(*args, **kwargs)

        with mock.patch.object(booking_services, "settle_payment", flaky):
            crashed = deliver(body, headers, raise_errors=False)
            retried = deliver(body, headers)

        assert crashed.status_code == 500  # the gateway will retry
        assert retried.json()["outcome"] == "applied"
        assert booking_of(payment).status == "confirmed"
        assert PaymentEvent.objects.filter(source="webhook").count() == 1

    def test_a_late_failure_never_undoes_a_success(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        notify(payment)

        late = notify(payment, "failed")

        assert late.json()["outcome"] == "ignored"
        assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.SUCCESSFUL
        assert booking_of(payment).status == "confirmed"


class TestForgedOrStrangeNotifications:
    def test_a_forged_signature_is_rejected(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        body, headers = signed(payment)

        response = deliver(body.replace(b"succeeded", b"succeeded "), headers)
        unsigned = deliver(body, {})

        assert (response.status_code, unsigned.status_code) == (400, 400)
        assert response.json()["error"]["code"] == "invalid_notification"
        assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.PENDING
        assert not PaymentEvent.objects.filter(source="webhook").exists()

    def test_an_unknown_gateway_is_404(self, db):
        response = deliver(b"{}", {}, provider="stripe")

        assert response.status_code == 404

    def test_a_notification_for_an_unknown_payment_is_acknowledged(self, db):
        provider = MockProvider()
        body, headers = provider.notification(
            {"order_id": "TXNNOSUCHPAYMENT", "status": "succeeded", "amount": "10.00"}
        )

        response = deliver(body, headers)

        assert response.json()["outcome"] == "unknown_payment"
        assert PaymentEvent.objects.get().outcome == EventOutcome.REJECTED

    def test_a_wrong_amount_is_rejected_and_flagged_for_refund(self, trip, alice):
        _, payment = start(client_for(alice), trip)

        response = notify(payment, amount="1.00")

        assert response.json()["outcome"] == "rejected"
        payment.refresh_from_db()
        assert (payment.status, payment.requires_refund) == (PaymentStatus.FAILED, True)
        assert "LKR 1.00" in payment.failure_reason
        assert booking_of(payment).status == "payment_pending"
        assert not Ticket.objects.exists()


class TestFailedPayment:
    def test_a_declined_payment_keeps_the_seats_until_the_hold_ends(self, trip, alice, bob):
        client = client_for(alice)
        _, payment = start(client, trip)

        notify(payment, "failed", message="Do not honour")

        payment.refresh_from_db()
        assert (payment.status, payment.failure_reason) == (PaymentStatus.FAILED, "Do not honour")
        assert booking_of(payment).status == "payment_pending"
        assert lock(client_for(bob), trip, "15").status_code == 409

    def test_the_seats_are_released_when_the_hold_ends_unpaid(self, trip, alice, bob):
        _, payment = start(client_for(alice), trip)
        notify(payment, "failed")
        expire_bookings()

        assert lock(client_for(bob), trip, "15").status_code == 201
        assert booking_of(payment).status == "expired"


class TestLatePayments:
    def test_a_payment_that_lands_after_the_hold_takes_back_free_seats(self, trip, alice):
        _, payment = start(client_for(alice), trip, "15", "16")
        expire_bookings()
        booking_services.release_expired_holds()
        assert booking_of(payment).status == "expired"

        notify(payment)

        payment.refresh_from_db()
        assert (payment.status, payment.requires_refund) == (PaymentStatus.SUCCESSFUL, False)
        assert booking_of(payment).status == "confirmed"
        assert Passenger.objects.filter(booking_id=payment.booking_id, holds_seat=True).count() == 2

    def test_a_payment_that_lands_after_the_seats_were_taken_needs_a_refund(self, trip, alice, bob):
        _, payment = start(client_for(alice), trip)
        expire_bookings()
        assert lock(client_for(bob), trip, "15").status_code == 201

        response = notify(payment)

        assert response.json()["outcome"] == "applied"
        payment.refresh_from_db()
        assert (payment.status, payment.requires_refund) == (PaymentStatus.SUCCESSFUL, True)
        assert "seats were gone" in payment.failure_reason
        assert booking_of(payment).status == "expired"
        assert not Ticket.objects.exists()

    def test_paying_twice_for_one_booking_flags_the_extra_payment(self, trip, alice, staff):
        booking, online = start(client_for(alice), trip)
        # Meanwhile the customer paid cash at the counter.
        assert client_for(staff).post(booking_url(booking, "confirm/")).status_code == 200
        online.refresh_from_db()
        assert online.status == PaymentStatus.CANCELLED

        notify(online)

        online.refresh_from_db()
        assert (online.status, online.requires_refund) == (PaymentStatus.SUCCESSFUL, True)
        assert Ticket.objects.count() == 1

    def test_a_cancelled_booking_is_not_revived_by_a_late_payment(self, trip, alice):
        client = client_for(alice)
        booking, payment = start(client, trip)
        client.post(booking_url(booking, "cancel/"), {"reason": "Changed plans"})

        notify(payment)

        payment.refresh_from_db()
        assert payment.requires_refund
        assert booking_of(payment).status == "cancelled"


class TestTimeouts:
    def test_a_lost_notification_is_recovered_by_a_status_check(self, trip, alice):
        client = client_for(alice)
        _, payment = start(client, trip)
        MockProvider().record(payment, status="succeeded", method="card")  # never delivered

        body = client.post(f"{PAYMENTS}{payment.pk}/verify/").json()

        assert body["status"] == "successful"
        assert body["booking_status"] == "confirmed"
        assert PaymentEvent.objects.filter(source="reconcile").count() == 1

    def test_the_sweep_command_recovers_lost_notifications(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        MockProvider().record(payment, status="succeeded", method="card")
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=5)
        )

        call_command("reconcile_payments", stdout=mock.MagicMock())

        assert booking_of(payment).status == "confirmed"

    def test_an_abandoned_attempt_is_given_up(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        long_ago = timezone.now() - timedelta(hours=2)
        Payment.objects.filter(pk=payment.pk).update(created_at=long_ago, expires_at=long_ago)

        call_command("reconcile_payments", stdout=mock.MagicMock())

        payment.refresh_from_db()
        assert payment.status == PaymentStatus.CANCELLED
        assert payment.failure_reason == "The payment wasn’t completed in time."

    def test_a_recent_attempt_is_left_alone(self, trip, alice):
        _, payment = start(client_for(alice), trip)
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=5)
        )

        call_command("reconcile_payments", stdout=mock.MagicMock())

        assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.PENDING

    def test_only_the_payer_can_ask_for_a_status_check(self, trip, alice, bob):
        _, payment = start(client_for(alice), trip)

        assert client_for(bob).post(f"{PAYMENTS}{payment.pk}/verify/").status_code == 404
