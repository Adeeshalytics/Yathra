"""
The ticket's own link, and "Find my booking".

The link is how a passenger who isn't the account holder gets their ticket, so it works without
signing in — which is exactly why it must show nothing but the journey. "Find my booking" never
shows anything at all: it texts the ticket to a phone that is already on the booking.
"""

import json
import logging

import pytest
from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from apps.bookings.services import cancel_booking
from apps.core.logging import EVENT_LOGGER
from apps.notifications import sms
from apps.notifications.models import Notification, NotificationKind
from apps.tickets.models import Ticket

from .conftest import book, client_for, confirm_at_counter, texts_to

pytestmark = pytest.mark.django_db

FIND = "/api/v1/tickets/find/"
GENERIC = "If that booking reference and phone number match a paid booking"


def shared(code: str, suffix: str = "") -> str:
    return f"/api/v1/tickets/shared/{code}/{suffix}"


@pytest.fixture
def paid(trip, alice, staff):
    return confirm_at_counter(staff, book(alice, trip, "15", "16"))


class TestTheSharedTicketLink:
    def test_the_link_opens_the_ticket_without_signing_in(self, paid):
        response = APIClient().get(shared(paid.ticket.share_code))

        assert response.status_code == 200
        body = response.json()
        assert body["booking_reference"] == paid.booking_reference
        assert (body["status"], body["is_valid"]) == ("valid", True)
        assert [p["seat_number"] for p in body["passengers"]] == ["15", "16"]
        assert body["boarding"]["name"] == "Colombo"
        assert body["trip"]["bus_registration"] == "WP NC-4521"
        assert body["qr_code"].startswith("data:image/svg+xml;base64,")
        assert response["Cache-Control"] == "private, no-store"

    def test_the_link_shows_no_contact_details_or_money(self, paid, alice):
        raw = json.dumps(APIClient().get(shared(paid.ticket.share_code)).json())

        for private in (alice.email, alice.phone, "+9477", "@example.com", "amount", "2500"):
            assert private not in raw

    def test_a_made_up_link_opens_nothing(self, paid):
        client = APIClient()
        assert client.get(shared("A" * 22)).status_code == 404
        assert client.get(shared("not a code!")).status_code == 404
        assert client.get(shared(paid.ticket.share_code[:-1])).status_code == 404

    def test_the_ticket_downloads_as_a_pdf(self, paid):
        response = APIClient().get(shared(paid.ticket.share_code, "pdf/"))

        assert response.status_code == 200
        assert response["Content-Type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")

    def test_a_cancelled_booking_link_says_so(self, paid, staff):
        cancel_booking(paid, reason="", allow_paid=True, actor=staff)

        body = APIClient().get(shared(paid.ticket.share_code)).json()

        assert (body["status"], body["is_valid"]) == ("cancelled", False)

    def test_the_customer_sees_their_ticket_link(self, paid, alice):
        body = client_for(alice).get(f"/api/v1/bookings/{paid.pk}/ticket/").json()

        assert body["share_url"] == f"http://localhost:3000/t/{paid.ticket.share_code}"

    def test_every_ticket_has_its_own_unguessable_code(self, paid, trip, bob, staff):
        other = confirm_at_counter(staff, book(bob, trip, "20"))

        codes = list(Ticket.objects.values_list("share_code", flat=True))
        assert paid.ticket.share_code != other.ticket.share_code
        assert len(set(codes)) == len(codes)
        # 16 random bytes, URL-safe base64: 22 characters.
        assert all(len(code) == 22 for code in codes)


class TestFindMyBooking:
    @pytest.fixture(autouse=True)
    def _send_on_commit(self, django_capture_on_commit_callbacks):
        # Texts go out once the request's transaction commits; the test transaction never does.
        self.committed = django_capture_on_commit_callbacks

    def ask(self, reference: str, phone: str, client=None):
        with self.committed(execute=True):
            return (client or APIClient()).post(
                FIND, {"reference": reference, "phone": phone}, format="json"
            )

    def test_the_ticket_is_texted_to_the_account_phone(self, paid, alice):
        response = self.ask(paid.booking_reference, alice.phone)

        assert response.status_code == 202
        assert GENERIC in response.json()["detail"]
        assert len(sms.outbox) == 1
        assert texts_to(alice.phone) and paid.ticket.share_url in texts_to(alice.phone)[0]
        assert Notification.objects.filter(kind=NotificationKind.TICKET_RESENT).count() == 1

    def test_a_passengers_phone_works_however_it_is_typed(self, paid):
        response = self.ask(f" {paid.booking_reference.lower()} ", "077 123 4567")

        assert response.status_code == 202
        assert [message["to"] for message in sms.outbox] == ["+94771234567"]

    def test_a_phone_that_is_not_on_the_booking_gets_nothing_and_learns_nothing(self, paid):
        response = self.ask(paid.booking_reference, "070 999 9999")

        assert response.status_code == 202
        assert GENERIC in response.json()["detail"]
        assert sms.outbox == []

    def test_an_unknown_reference_gets_the_same_answer(self, paid, alice):
        response = self.ask("YTNOTREAL1", alice.phone)

        assert response.status_code == 202
        assert GENERIC in response.json()["detail"]
        assert sms.outbox == []

    def test_an_unpaid_booking_is_not_texted(self, trip, bob):
        booking = book(bob, trip, "30")

        assert self.ask(booking.booking_reference, bob.phone).status_code == 202
        assert sms.outbox == []

    def test_asking_twice_in_a_row_sends_one_text(self, paid, alice):
        self.ask(paid.booking_reference, alice.phone)
        self.ask(paid.booking_reference, alice.phone)

        assert len(sms.outbox) == 1

    def test_the_request_is_logged_without_the_full_number(self, paid, alice, caplog):
        caplog.set_level(logging.INFO, logger=EVENT_LOGGER)

        self.ask(paid.booking_reference, alice.phone)

        record = next(
            r for r in caplog.records if getattr(r, "event", "") == "ticket.find_requested"
        )
        assert record.matched is True
        assert alice.phone not in json.dumps(record.__dict__, default=str)

    def test_a_bad_phone_number_is_a_field_error(self, paid):
        response = self.ask(paid.booking_reference, "12")

        assert response.status_code == 400
        assert "phone" in response.json()["error"]["details"]

    @override_settings(SMS={"BACKEND": ""})
    def test_without_text_messages_it_says_it_cannot_help(self, paid, alice):
        response = self.ask(paid.booking_reference, alice.phone)

        assert response.status_code == 503
        assert response.json()["error"]["code"] == "sms_unavailable"

    def test_it_is_rate_limited(self, paid, alice, monkeypatch):
        monkeypatch.setattr(SimpleRateThrottle, "THROTTLE_RATES", {"ticket_find": "2/min"})
        client = APIClient()

        codes = [self.ask("YTNOTREAL1", alice.phone, client).status_code for _ in range(3)]

        assert codes == [202, 202, 429]
