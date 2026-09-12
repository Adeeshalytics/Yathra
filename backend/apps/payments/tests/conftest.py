from datetime import timedelta

from django.test import Client
from django.utils import timezone

from apps.bookings.models import Booking
from apps.bookings.tests.conftest import (  # noqa: F401 — shared fixtures
    BOOKINGS,
    alice,
    bob,
    bus,
    client_for,
    hold_and_book,
    lock,
    route,
    staff,
    trip,
)
from apps.payments.models import Payment
from apps.payments.providers.mock import MockProvider
from apps.payments.providers.payhere import PayHereProvider

PAYMENTS = "/api/v1/payments/"
ADMIN_PAYMENTS = "/api/v1/admin/payments/"


def webhook_url(provider: str = "mock") -> str:
    return f"{PAYMENTS}webhooks/{provider}/"


def booking_url(booking: dict, suffix: str = "") -> str:
    return f"{BOOKINGS}{booking['id']}/{suffix}"


def book(client, on_trip, *seats) -> dict:
    response = hold_and_book(client, on_trip, *(seats or ("15",)))
    assert response.status_code == 201, response.content
    return response.json()


def pay(client, booking: dict, provider: str = "mock"):
    return client.post(PAYMENTS, {"booking": booking["id"], "provider": provider}, format="json")


def start(client, on_trip, *seats, provider: str = "mock") -> tuple[dict, Payment]:
    """Book seats and press Pay Now: (booking json, the open payment)."""
    booking = book(client, on_trip, *seats)
    response = pay(client, booking, provider)
    assert response.status_code == 201, response.content
    return booking, Payment.objects.get(pk=response.json()["payment"]["id"])


def signed(payment: Payment, status: str = "succeeded", *, amount=None, event_id=None, **state):
    """A notification from the test gateway, as it would arrive over HTTP: (body, headers)."""
    provider = MockProvider()
    recorded = provider.record(
        payment, status=status, method=state.pop("method", "card"), message=state.pop("message", "")
    )
    if amount is not None:
        recorded = {**recorded, "amount": amount}
    return provider.notification({**recorded, **state}, event_id=event_id)


def deliver(body: bytes, headers: dict, provider: str = "mock", *, raise_errors: bool = True):
    return Client(raise_request_exception=raise_errors).post(
        webhook_url(provider), data=body, content_type="application/json", headers=headers
    )


def notify(payment: Payment, status: str = "succeeded", **kwargs):
    return deliver(*signed(payment, status, **kwargs))


def payhere_notice(payment: Payment, status_code: str = "2", **overrides) -> dict:
    """A PayHere notification form, signed the way PayHere signs it (card fields included)."""
    data = {
        "merchant_id": "1211149",
        "order_id": payment.transaction_reference,
        "payment_id": str(payment.pk.int)[:12],  # PayHere's own id: unique per payment
        "payhere_amount": f"{payment.amount:.2f}",
        "payhere_currency": payment.currency,
        "status_code": status_code,
        "status_message": "Successfully completed the payment.",
        "method": "VISA",
        "card_holder_name": "K FERNANDO",
        "card_no": "************1292",
        "card_expiry": "12/30",
        **overrides,
    }
    data.setdefault("md5sig", PayHereProvider().notification_signature(data))
    return data


def deliver_payhere(data: dict):
    from urllib.parse import urlencode

    return Client().post(
        webhook_url("payhere"),
        data=urlencode(data),
        content_type="application/x-www-form-urlencoded",
    )


def expire_bookings():
    Booking.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
