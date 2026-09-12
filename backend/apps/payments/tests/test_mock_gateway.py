"""The built-in test gateway's hosted page behaves like a real gateway's."""

import pytest
from django.test import Client, override_settings

from apps.bookings.models import Booking
from apps.payments.models import Payment, PaymentStatus

from .conftest import PAYMENTS, client_for, start

pytestmark = pytest.mark.django_db


def open_checkout(alice, trip):
    client = client_for(alice)
    booking, _ = start(client, trip)
    response = client.post(PAYMENTS, {"booking": booking["id"]}, format="json").json()
    return booking, Payment.objects.get(pk=response["payment"]["id"]), response["checkout"]["url"]


def path_of(url: str) -> str:
    return url.removeprefix("http://testserver")


class TestCheckoutPage:
    def test_shows_the_amount_and_asks_for_no_card_details(self, trip, alice):
        booking, payment, url = open_checkout(alice, trip)

        page = Client().get(path_of(url))

        assert page.status_code == 200
        html = page.content.decode()
        assert payment.transaction_reference in html
        assert booking["booking_reference"] in html
        assert "LKR 2,500.00" in html
        for field in ('name="card', "cvv", 'name="pin'):
            assert field not in html.lower()

    def test_paying_confirms_through_the_signed_notification(self, trip, alice):
        booking, payment, url = open_checkout(alice, trip)

        response = Client().post(path_of(url), {"outcome": "pay", "method": "card"})

        assert response.status_code == 302
        assert response["Location"] == (
            f"http://localhost:3000/bookings/{booking['id']}/payment?payment={payment.pk}"
        )
        assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.SUCCESSFUL
        assert Booking.objects.get(pk=booking["id"]).status == "confirmed"

    def test_a_declined_payment(self, trip, alice):
        _, payment, url = open_checkout(alice, trip)

        Client().post(path_of(url), {"outcome": "decline", "method": "mobile_wallet"})

        payment.refresh_from_db()
        assert payment.status == PaymentStatus.FAILED
        assert "declined" in payment.failure_reason

    def test_cancelling_returns_to_the_cancel_url_without_a_notification(self, trip, alice):
        _, payment, url = open_checkout(alice, trip)

        response = Client().post(path_of(url), {"outcome": "cancel", "method": "card"})

        assert response["Location"].endswith("&cancelled=1")
        assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.PENDING

    def test_a_held_back_notification_is_found_by_the_status_check(self, trip, alice):
        _, payment, url = open_checkout(alice, trip)

        Client().post(path_of(url), {"outcome": "pay_later", "method": "card"})
        pending = Payment.objects.get(pk=payment.pk).status
        verified = client_for(alice).post(f"{PAYMENTS}{payment.pk}/verify/").json()

        assert pending == PaymentStatus.PENDING
        assert verified["status"] == "successful"

    def test_a_finished_payment_cannot_be_paid_again_on_the_page(self, trip, alice):
        _, _, url = open_checkout(alice, trip)
        Client().post(path_of(url), {"outcome": "pay", "method": "card"})

        page = Client().get(path_of(url))
        again = Client().post(path_of(url), {"outcome": "pay", "method": "card"})

        assert "already successful" in page.content.decode()
        assert again.status_code == 302
        assert Payment.objects.filter(status=PaymentStatus.SUCCESSFUL).count() == 1

    def test_rejects_a_tampered_or_missing_session(self, db):
        assert Client().get("/api/v1/payments/mock/checkout/?session=forged").status_code == 400
        assert Client().get("/api/v1/payments/mock/checkout/").status_code == 400

    def test_rejects_unknown_outcomes(self, trip, alice):
        _, _, url = open_checkout(alice, trip)

        assert Client().post(path_of(url), {"outcome": "steal"}).status_code == 400

    def test_is_gone_when_the_test_gateway_is_switched_off(self, trip, alice):
        _, _, url = open_checkout(alice, trip)

        with override_settings(PAYMENT_PROVIDERS=["payhere"]):
            assert Client().get(path_of(url)).status_code == 404
