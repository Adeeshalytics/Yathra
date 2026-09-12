from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.bookings.models import Booking
from apps.core.tests.factories import OperatorUserFactory
from apps.payments.models import Payment, PaymentEvent, PaymentStatus

from .conftest import (
    PAYMENTS,
    book,
    booking_url,
    client_for,
    expire_bookings,
    lock,
    notify,
    pay,
    start,
)

pytestmark = pytest.mark.django_db


class TestProviders:
    def test_lists_the_gateways_customers_can_use(self, alice):
        body = client_for(alice).get(f"{PAYMENTS}providers/").json()

        assert body["default"] == "mock"
        assert [p["code"] for p in body["providers"]] == ["mock", "payhere"]
        assert body["providers"][1]["test_mode"] is True  # PayHere sandbox

    @override_settings(PAYMENT_PROVIDERS=["payhere"], PAYMENT_DEFAULT_PROVIDER="mock")
    def test_switched_off_gateways_are_not_offered(self, alice):
        body = client_for(alice).get(f"{PAYMENTS}providers/").json()

        assert [p["code"] for p in body["providers"]] == ["payhere"]
        assert body["default"] == "payhere"

    @override_settings(PAYHERE={"MERCHANT_ID": "", "MERCHANT_SECRET": "", "SANDBOX": True})
    def test_gateways_without_credentials_are_not_offered(self, alice):
        body = client_for(alice).get(f"{PAYMENTS}providers/").json()

        assert [p["code"] for p in body["providers"]] == ["mock"]


class TestPayNow:
    def test_opens_a_hosted_checkout_and_holds_the_seats_for_payment(self, trip, alice):
        client = client_for(alice)
        booking = book(client, trip, "15", "16")
        held_until = Booking.objects.get(pk=booking["id"]).expires_at

        response = pay(client, booking)

        assert response.status_code == 201, response.content
        body = response.json()
        assert body["payment"]["status"] == "pending"
        assert body["payment"]["amount"] == "5000.00"
        assert body["payment"]["booking_reference"] == booking["booking_reference"]
        checkout = body["checkout"]
        assert checkout["method"] == "redirect"
        assert urlparse(checkout["url"]).path == "/api/v1/payments/mock/checkout/"
        assert "session" in parse_qs(urlparse(checkout["url"]).query)
        saved = Booking.objects.get(pk=booking["id"])
        assert saved.status == "payment_pending"
        assert saved.expires_at > held_until  # the payment window
        assert saved.expires_at <= saved.created_at + timedelta(minutes=20)
        assert PaymentEvent.objects.filter(source="checkout").count() == 1

    def test_never_holds_seats_beyond_the_maximum(self, trip, alice):
        client = client_for(alice)
        booking = book(client, trip, "15")
        now = timezone.now()
        Booking.objects.filter(pk=booking["id"]).update(
            created_at=now - timedelta(minutes=15), expires_at=now + timedelta(seconds=30)
        )

        pay(client, booking)

        expires_at = Booking.objects.get(pk=booking["id"]).expires_at
        assert now + timedelta(minutes=4) < expires_at <= now + timedelta(minutes=5, seconds=5)

    def test_pressing_pay_now_again_resumes_the_same_attempt(self, trip, alice):
        client = client_for(alice)
        booking, payment = start(client, trip)

        again = pay(client, booking)

        assert again.status_code == 201
        assert again.json()["payment"]["id"] == str(payment.pk)
        assert Payment.objects.count() == 1

    def test_switching_gateway_replaces_the_open_attempt(self, trip, alice):
        client = client_for(alice)
        booking, first = start(client, trip)

        response = pay(client, booking, "payhere")

        first.refresh_from_db()
        assert first.status == PaymentStatus.CANCELLED
        assert first.failure_reason == "Replaced by a new payment attempt."
        second = Payment.objects.get(pk=response.json()["payment"]["id"])
        assert (second.provider, second.status) == ("payhere", PaymentStatus.PENDING)
        assert response.json()["checkout"]["method"] == "post"

    def test_retrying_after_a_declined_payment_opens_a_new_attempt(self, trip, alice):
        client = client_for(alice)
        booking, declined = start(client, trip)
        notify(declined, "failed", message="Insufficient funds")

        retry = pay(client, booking)

        assert retry.status_code == 201
        assert retry.json()["payment"]["id"] != str(declined.pk)
        assert Payment.objects.filter(booking_id=booking["id"]).count() == 2

    def test_a_payment_the_bank_is_still_processing_blocks_a_second_one(self, trip, alice):
        client = client_for(alice)
        booking, payment = start(client, trip)
        notify(payment, "processing")

        response = pay(client, booking)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "payment_in_progress"

    def test_paying_after_the_hold_ran_out_is_refused(self, trip, alice):
        client = client_for(alice)
        booking = book(client, trip, "15")
        expire_bookings()

        response = pay(client, booking)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "hold_expired"
        assert Booking.objects.get(pk=booking["id"]).status == "expired"
        assert not Payment.objects.exists()

    def test_a_paid_booking_cannot_be_paid_again(self, trip, alice):
        client = client_for(alice)
        booking, payment = start(client, trip)
        notify(payment)

        response = pay(client, booking)

        assert response.status_code == 409
        assert Payment.objects.count() == 1

    def test_unknown_gateways_are_refused(self, trip, alice):
        client = client_for(alice)
        booking = book(client, trip)

        response = pay(client, booking, "bitcoin")

        assert response.status_code == 400
        assert "provider" in response.json()["error"]["details"]

    def test_customers_pay_only_for_their_own_bookings(self, trip, alice, bob, staff):
        booking = book(client_for(alice), trip)

        assert pay(client_for(bob), booking).status_code == 404
        assert pay(client_for(staff), booking).status_code == 404
        assert pay(client_for(OperatorUserFactory()), booking).status_code == 403
        assert not Payment.objects.exists()


class TestFollowingAPayment:
    def test_customers_see_their_own_payments_only(self, trip, alice, bob):
        _, payment = start(client_for(alice), trip)

        mine = client_for(alice).get(f"{PAYMENTS}{payment.pk}/")
        theirs = client_for(bob).get(f"{PAYMENTS}{payment.pk}/")

        assert mine.status_code == 200
        assert mine.json()["booking_status"] == "payment_pending"
        assert "provider_data" not in mine.json()
        assert theirs.status_code == 404
        assert client_for(bob).get(PAYMENTS).json()["count"] == 0

    def test_the_booking_shows_its_latest_payment(self, trip, alice):
        client = client_for(alice)
        booking, payment = start(client, trip)
        notify(payment, "failed", message="Card declined")

        body = client.get(booking_url(booking)).json()

        assert body["payment"]["status"] == "failed"
        assert body["payment"]["failure_reason"] == "Card declined"
        assert body["ticket"] is None

    def test_cancelling_on_the_gateway_page_keeps_the_booking_for_a_retry(self, trip, alice, bob):
        client = client_for(alice)
        booking, payment = start(client, trip)

        response = client.post(f"{PAYMENTS}{payment.pk}/cancel/")

        assert response.json()["status"] == "cancelled"
        assert Booking.objects.get(pk=booking["id"]).status == "payment_pending"
        assert lock(client_for(bob), trip, "15").status_code == 409  # still held
        assert pay(client, booking).status_code == 201

    def test_only_the_payer_cancels_an_attempt(self, trip, alice, bob):
        _, payment = start(client_for(alice), trip)

        assert client_for(bob).post(f"{PAYMENTS}{payment.pk}/cancel/").status_code == 404
