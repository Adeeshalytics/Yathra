import hashlib
import json
from unittest import mock

import pytest
from django.test import override_settings

from apps.bookings.models import Booking
from apps.payments.models import Payment, PaymentEvent, PaymentStatus
from apps.payments.providers import InvalidNotification
from apps.payments.providers.mock import MockProvider
from apps.payments.providers.payhere import PayHereProvider

from .conftest import (
    PAYMENTS,
    client_for,
    deliver,
    deliver_payhere,
    payhere_notice,
    start,
)

pytestmark = pytest.mark.django_db

SECRET_HASH = hashlib.md5(b"test-merchant-secret").hexdigest().upper()  # noqa: S324


def md5(value: str) -> str:
    return hashlib.md5(value.encode()).hexdigest().upper()  # noqa: S324


class TestPayHereCheckout:
    def test_posts_a_signed_form_to_the_hosted_checkout(self, trip, alice):
        booking, payment = start(client_for(alice), trip, "15", "16", provider="payhere")

        checkout = (
            client_for(alice)
            .post(PAYMENTS, {"booking": booking["id"], "provider": "payhere"}, format="json")
            .json()["checkout"]
        )

        fields = checkout["fields"]
        assert (checkout["method"], checkout["url"]) == (
            "post",
            "https://sandbox.payhere.lk/pay/checkout",
        )
        assert fields["order_id"] == payment.transaction_reference
        assert (fields["amount"], fields["currency"]) == ("5000.00", "LKR")
        # PayHere's documented formula, computed independently.
        expected = md5(f"1211149{payment.transaction_reference}5000.00LKR{SECRET_HASH}")
        assert fields["hash"] == expected
        assert fields["notify_url"] == "http://testserver/api/v1/payments/webhooks/payhere/"
        assert fields["return_url"].startswith(
            f"http://localhost:3000/bookings/{booking['id']}/payment?payment={payment.pk}"
        )
        assert fields["cancel_url"].endswith("&cancelled=1")
        assert fields["email"] == alice.email
        assert "test-merchant-secret" not in json.dumps(checkout)

    @override_settings(
        PAYHERE={"MERCHANT_ID": "1", "MERCHANT_SECRET": "s", "SANDBOX": False, "APP_ID": ""}
    )
    def test_uses_the_live_gateway_when_sandbox_is_off(self):
        assert PayHereProvider().base_url == "https://www.payhere.lk"


class TestPayHereNotifications:
    def test_a_signed_success_confirms_the_booking(self, trip, alice):
        _, payment = start(client_for(alice), trip, provider="payhere")

        response = deliver_payhere(payhere_notice(payment))

        assert response.json()["outcome"] == "applied"
        payment.refresh_from_db()
        assert payment.status == PaymentStatus.SUCCESSFUL
        assert (payment.provider_reference, payment.payment_method) == (
            str(payment.pk.int)[:12],
            "card",
        )
        assert Booking.objects.get(pk=payment.booking_id).status == "confirmed"

    def test_card_details_are_never_stored(self, trip, alice):
        _, payment = start(client_for(alice), trip, provider="payhere")

        deliver_payhere(payhere_notice(payment))

        stored = json.dumps(
            [
                list(Payment.objects.values_list("provider_data", flat=True)),
                list(PaymentEvent.objects.values_list("data", "message")),
            ]
        )
        for secret in ("card_no", "1292", "card_holder_name", "K FERNANDO", "12/30", "md5sig"):
            assert secret not in stored

    @pytest.mark.parametrize(
        ("status_code", "expected"),
        [("0", "processing"), ("-1", "cancelled"), ("-2", "failed")],
    )
    def test_maps_payhere_status_codes(self, trip, alice, status_code, expected):
        _, payment = start(client_for(alice), trip, provider="payhere")

        deliver_payhere(payhere_notice(payment, status_code))

        assert Payment.objects.get(pk=payment.pk).status == expected

    def test_a_chargeback_refunds_and_cancels(self, trip, alice):
        _, payment = start(client_for(alice), trip, provider="payhere")
        deliver_payhere(payhere_notice(payment))

        deliver_payhere(payhere_notice(payment, "-3", status_message="Charged back"))

        payment.refresh_from_db()
        assert (payment.status, payment.refunded_amount) == (PaymentStatus.REFUNDED, payment.amount)
        assert Booking.objects.get(pk=payment.booking_id).status == "cancelled"

    def test_a_forged_notification_is_rejected(self, trip, alice):
        _, payment = start(client_for(alice), trip, provider="payhere")

        wrong_sig = deliver_payhere(payhere_notice(payment, md5sig="0" * 32))
        # Signature computed for another amount, then the amount changed.
        tampered = payhere_notice(payment)
        tampered["payhere_amount"] = "1.00"
        other_merchant = payhere_notice(payment, merchant_id="999")

        assert wrong_sig.status_code == 400
        assert deliver_payhere(tampered).status_code == 400
        assert deliver_payhere(other_merchant).status_code == 400
        assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.PENDING

    def test_a_signed_notification_with_the_wrong_amount_is_rejected(self, trip, alice):
        _, payment = start(client_for(alice), trip, provider="payhere")

        response = deliver_payhere(payhere_notice(payment, payhere_amount="1.00"))

        assert response.json()["outcome"] == "rejected"
        assert Payment.objects.get(pk=payment.pk).requires_refund

    def test_parse_rejects_missing_fields(self):
        with pytest.raises(InvalidNotification):
            PayHereProvider().parse_notification(body=b"", headers={}, data={"order_id": "x"})


class TestPayHereStatusApi:
    @override_settings(
        PAYHERE={
            "MERCHANT_ID": "1211149",
            "MERCHANT_SECRET": "test-merchant-secret",
            "APP_ID": "app",
            "APP_SECRET": "secret",
            "SANDBOX": True,
        }
    )
    def test_a_status_check_applies_what_payhere_reports(self, trip, alice):
        client = client_for(alice)
        _, payment = start(client, trip, provider="payhere")
        row = {
            "payment_id": 320027150501,
            "order_id": payment.transaction_reference,
            "status": "RECEIVED",
            "amount": 2500.0,
            "currency": "LKR",
            "method": {"method": "VISA", "card_customer_name": "K FERNANDO", "card_no": "1292"},
        }
        replies = [{"access_token": "token"}, {"status": 1, "data": [row]}]

        with mock.patch.object(PayHereProvider, "_call", side_effect=replies):
            body = client.post(f"{PAYMENTS}{payment.pk}/verify/").json()

        assert (body["status"], body["booking_status"]) == ("successful", "confirmed")
        assert "1292" not in json.dumps(Payment.objects.get(pk=payment.pk).provider_data)

    def test_without_api_keys_payhere_cannot_be_asked(self, trip, alice):
        _, payment = start(client_for(alice), trip, provider="payhere")

        assert PayHereProvider().fetch_status(payment) is None


class TestMockGatewaySignatures:
    def test_signs_with_the_configured_secret(self):
        body = b'{"a":1}'

        assert (
            MockProvider().sign(body)
            == __import__("hmac").new(b"test-mock-secret", body, "sha256").hexdigest()
        )

    @override_settings(PAYMENT_PROVIDERS=["payhere"])
    def test_its_notifications_are_refused_when_it_is_switched_off(self, trip, alice):
        _, payment = start(client_for(alice), trip, provider="payhere")
        body, headers = MockProvider().notification(
            {"order_id": payment.transaction_reference, "status": "succeeded", "amount": "2500"}
        )

        assert deliver(body, headers).status_code == 404
