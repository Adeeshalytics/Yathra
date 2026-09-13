"""A customer with nothing but a phone number can book, pay and get their ticket."""

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications import sms
from apps.payments.tests.conftest import notify, pay

from .conftest import booking_payload, lock

pytestmark = pytest.mark.django_db

PHONE = "+94771234567"


def sign_in_by_phone() -> tuple[APIClient, User]:
    client = APIClient()
    sms.outbox.clear()
    assert (
        client.post("/api/v1/auth/phone/code/", {"phone": PHONE}, format="json").status_code == 202
    )
    code = sms.outbox[-1]["text"][:6]
    response = client.post(
        "/api/v1/auth/phone/verify/", {"phone": PHONE, "code": code}, format="json"
    )
    assert response.status_code == 201, response.content
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['access']}")
    return client, User.objects.get(phone=PHONE)


def test_a_phone_only_customer_books_pays_and_is_texted_the_ticket(
    trip, django_capture_on_commit_callbacks
):
    client, customer = sign_in_by_phone()
    sms.outbox.clear()

    assert lock(client, trip, "15").status_code == 201
    passenger = {"seat_number": "15", "name": "Kasuni Fernando", "phone": "077 123 4567"}
    booking = client.post(
        "/api/v1/bookings/", booking_payload(trip, "15", passengers=[passenger]), format="json"
    )
    assert booking.status_code == 201, booking.content
    booking = booking.json()

    # The account takes its name from the first passenger.
    customer.refresh_from_db()
    assert customer.name == "Kasuni Fernando"

    # PayHere insists on an e-mail: the checkout falls back to the platform's own address.
    checkout = pay(client, booking, "payhere").json()["checkout"]
    assert checkout["fields"]["email"] == "payments@yathra.lk"
    assert checkout["fields"]["phone"] == PHONE

    started = pay(client, booking)
    from apps.payments.models import Payment

    payment = Payment.objects.get(pk=started.json()["payment"]["id"])
    with django_capture_on_commit_callbacks(execute=True):
        assert notify(payment).status_code == 200

    # One number on the booking, so one text — and no e-mail anywhere.
    assert [message["to"] for message in sms.outbox] == [PHONE]
    assert booking["booking_reference"] in sms.outbox[0]["text"]
    assert mail.outbox == []
