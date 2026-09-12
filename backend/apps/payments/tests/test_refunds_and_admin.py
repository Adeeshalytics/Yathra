from unittest import mock

import pytest
from django.test import override_settings

from apps.audit.models import ActivityLog
from apps.bookings.models import Booking
from apps.payments.models import Payment, PaymentStatus
from apps.payments.providers.payhere import PayHereProvider
from apps.tickets.models import Ticket
from apps.trips.services import cancel_trip

from .conftest import (
    ADMIN_PAYMENTS,
    client_for,
    deliver_payhere,
    lock,
    notify,
    payhere_notice,
    start,
)

pytestmark = pytest.mark.django_db

PAYHERE_WITH_API = {
    "MERCHANT_ID": "1211149",
    "MERCHANT_SECRET": "test-merchant-secret",
    "APP_ID": "app-id",
    "APP_SECRET": "app-secret",
    "SANDBOX": True,
}


def paid(client, trip, *seats, provider="mock") -> Payment:
    _, payment = start(client, trip, *seats, provider=provider)
    if provider == "mock":
        notify(payment)
    else:
        deliver_payhere(payhere_notice(payment))
    payment.refresh_from_db()
    assert payment.status == PaymentStatus.SUCCESSFUL
    return payment


def refund(staff, payment, **body):
    return client_for(staff).post(f"{ADMIN_PAYMENTS}{payment.pk}/refund/", body, format="json")


class TestRefunds:
    def test_a_full_refund_cancels_the_booking_and_frees_the_seats(self, trip, alice, bob, staff):
        payment = paid(client_for(alice), trip, "15", "16")

        response = refund(staff, payment, reason="Customer asked")

        assert response.status_code == 200, response.content
        body = response.json()
        assert (body["status"], body["refunded_amount"]) == ("refunded", "5000.00")
        assert body["events"][-1]["source"] == "admin"
        booking = Booking.objects.get(pk=payment.booking_id)
        assert (booking.status, booking.cancellation_reason) == ("cancelled", "Customer asked")
        assert Ticket.objects.get(booking=booking).status == "cancelled"
        assert lock(client_for(bob), trip, "15").status_code == 201
        assert ActivityLog.objects.filter(action="refunded").count() == 1

    def test_a_partial_refund_keeps_the_booking(self, trip, alice, staff):
        payment = paid(client_for(alice), trip, "15", "16")

        first = refund(staff, payment, amount="1000.00")
        too_much = refund(staff, payment, amount="4000.01")
        rest = refund(staff, payment)

        assert (first.json()["status"], first.json()["refundable_amount"]) == (
            "partially_refunded",
            "4000.00",
        )
        assert too_much.status_code == 400
        assert "amount" in too_much.json()["error"]["details"]
        assert rest.json()["status"] == "refunded"
        assert Booking.objects.get(pk=payment.booking_id).status == "cancelled"

    def test_only_successful_payments_are_refunded(self, trip, alice, staff):
        _, payment = start(client_for(alice), trip)

        response = refund(staff, payment)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "not_refundable"

    def test_refunding_a_duplicate_payment_keeps_the_booking(self, trip, alice, staff):
        payment = paid(client_for(alice), trip)
        extra = Payment.objects.create(
            booking_id=payment.booking_id,
            provider="mock",
            amount=payment.amount,
            status=PaymentStatus.SUCCESSFUL,
            paid_at=payment.paid_at,
            requires_refund=True,
        )

        refund(staff, extra, reason="Paid twice")

        extra.refresh_from_db()
        assert (extra.status, extra.requires_refund) == (PaymentStatus.REFUNDED, False)
        assert Booking.objects.get(pk=payment.booking_id).status == "confirmed"

    def test_payhere_refunds_need_the_merchant_portal_without_api_keys(self, trip, alice, staff):
        payment = paid(client_for(alice), trip, provider="payhere")

        refused = refund(staff, payment)
        recorded = refund(staff, payment, external=True, reason="Refunded in the PayHere portal")

        assert refused.status_code == 409
        assert refused.json()["error"]["code"] == "refund_not_supported"
        assert recorded.json()["status"] == "refunded"

    @override_settings(PAYHERE=PAYHERE_WITH_API)
    def test_payhere_refunds_through_its_api_when_configured(self, trip, alice, staff):
        payment = paid(client_for(alice), trip, provider="payhere")
        other = paid(client_for(alice), trip, "20", provider="payhere")
        replies = [{"access_token": "token"}, {"status": 1, "msg": "Refund submitted", "data": 77}]

        with mock.patch.object(PayHereProvider, "_call", side_effect=replies) as call:
            response = refund(staff, payment)
            partial = refund(staff, other, amount="1.00")

        assert response.json()["status"] == "refunded"
        assert call.call_args_list[1].args[0] == "/merchant/v1/payment/refund"
        assert partial.status_code == 409  # PayHere's API refunds whole payments only

    def test_cancelling_the_trip_flags_paid_bookings_for_refund(self, trip, alice):
        payment = paid(client_for(alice), trip)

        cancel_trip(trip, "Bus breakdown")

        payment.refresh_from_db()
        assert payment.requires_refund
        assert Booking.objects.get(pk=payment.booking_id).status == "cancelled"

    def test_staff_cancelling_a_paid_booking_flags_it_for_refund(self, trip, alice, staff):
        payment = paid(client_for(alice), trip)

        client_for(staff).post(f"/api/v1/bookings/{payment.booking_id}/cancel/", {"reason": "x"})

        assert Payment.objects.get(pk=payment.pk).requires_refund


class TestAdminPayments:
    def test_lists_payments_with_their_booking(self, trip, alice, staff):
        payment = paid(client_for(alice), trip)
        start(client_for(alice), trip, "20")

        body = client_for(staff).get(ADMIN_PAYMENTS).json()

        assert body["count"] == 2
        row = next(r for r in body["results"] if r["id"] == str(payment.pk))
        assert row["transaction_reference"] == payment.transaction_reference
        assert row["booking_reference"] == payment.booking.booking_reference
        assert row["status"] == "successful"
        assert row["customer"]["email"] == alice.email
        assert row["trip"]["code"] == trip.code
        assert "events" not in row

    def test_filters_and_search(self, trip, alice, staff):
        payment = paid(client_for(alice), trip)
        start(client_for(alice), trip, "20")
        client = client_for(staff)

        by_status = client.get(ADMIN_PAYMENTS, {"status": "successful"}).json()
        by_reference = client.get(ADMIN_PAYMENTS, {"search": payment.booking.booking_reference})
        by_provider = client.get(ADMIN_PAYMENTS, {"provider": "payhere"}).json()

        assert [r["id"] for r in by_status["results"]] == [str(payment.pk)]
        assert by_reference.json()["count"] == 1
        assert by_provider["count"] == 0

    def test_detail_shows_the_event_timeline(self, trip, alice, staff):
        payment = paid(client_for(alice), trip)

        body = client_for(staff).get(f"{ADMIN_PAYMENTS}{payment.pk}/").json()

        assert [e["source"] for e in body["events"]] == ["checkout", "webhook"]
        assert body["booking_detail"]["seats"] == ["15"]
        assert body["refund_through_gateway"] is True

    def test_summary(self, trip, alice, staff):
        paid(client_for(alice), trip, "15", "16")

        body = client_for(staff).get(f"{ADMIN_PAYMENTS}summary/").json()

        assert body["collected_today"] == "5000.00"
        assert body["by_status"]["successful"] == 1
        assert body["needs_refund"] == 0

    def test_admins_can_ask_the_gateway_for_a_status(self, trip, alice, staff):
        from apps.payments.providers.mock import MockProvider

        _, payment = start(client_for(alice), trip)
        MockProvider().record(payment, status="succeeded", method="card")

        body = client_for(staff).post(f"{ADMIN_PAYMENTS}{payment.pk}/reconcile/").json()

        assert body["status"] == "successful"

    def test_customers_cannot_manage_payments(self, trip, alice):
        payment = paid(client_for(alice), trip)
        client = client_for(alice)

        assert client.get(ADMIN_PAYMENTS).status_code == 403
        assert client.post(f"{ADMIN_PAYMENTS}{payment.pk}/refund/").status_code == 403
