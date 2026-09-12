"""
Structured logging: the events an operator needs in order to reconstruct what happened.

Each event carries the ids that tie it to a record, and the request id every log line already
has. Nothing here may carry a password, a card number or a token.
"""

import json
import logging

import pytest

from apps.bookings.tests.conftest import hold_and_book
from apps.core.logging import EVENT_LOGGER, JSONFormatter, log_event

from .conftest import client_for

pytestmark = pytest.mark.django_db


def events(caplog) -> dict[str, logging.LogRecord]:
    return {
        record.event: record
        for record in caplog.records
        if record.name == EVENT_LOGGER and hasattr(record, "event")
    }


@pytest.fixture
def capture_events(caplog):
    caplog.set_level(logging.INFO, logger=EVENT_LOGGER)
    return caplog


class TestAuthenticationIsLogged:
    def test_a_sign_in_and_a_sign_out(self, api_client, customer, password, capture_events):
        api_client.post(
            "/api/v1/auth/login/", {"email": customer.email, "password": password}, format="json"
        )
        api_client.post("/api/v1/auth/logout/")

        recorded = events(capture_events)
        assert recorded["auth.login"].user_id == str(customer.pk)
        assert recorded["auth.login"].role == "customer"
        assert "auth.logout" in recorded

    def test_a_failed_sign_in_records_no_password(self, api_client, customer, capture_events):
        api_client.post(
            "/api/v1/auth/login/",
            {"email": customer.email, "password": "definitely-wrong"},
            format="json",
        )

        record = events(capture_events)["auth.login_failed"]
        assert record.levelno == logging.WARNING
        assert record.email == customer.email
        assert "definitely-wrong" not in json.dumps(record.__dict__, default=str)

    def test_a_password_change(self, api_client, customer, password, capture_events):
        api_client.force_authenticate(customer)

        api_client.post(
            "/api/v1/auth/password/",
            {"current_password": password, "new_password": "An0ther-Str0ng-Pass!"},
            format="json",
        )

        assert events(capture_events)["auth.password_changed"].user_id == str(customer.pk)


class TestTheBookingLifecycleIsLogged:
    def test_locking_booking_paying_and_cancelling(self, trip, alice, staff, capture_events):
        booking = hold_and_book(client_for(alice), trip, "15").json()
        client_for(staff).post(f"/api/v1/bookings/{booking['id']}/confirm/")
        client_for(alice).post(
            f"/api/v1/bookings/{booking['id']}/cancel/", {"reason": "Plans changed"}, format="json"
        )

        recorded = events(capture_events)
        assert recorded["seat.locked"].seats == ["15"]
        assert recorded["seat.locked"].trip_id == str(trip.pk)
        assert recorded["booking.created"].booking_reference == booking["booking_reference"]
        assert recorded["booking.created"].customer_id == str(alice.pk)
        assert recorded["payment.recorded"].provider == "manual"
        assert recorded["booking.confirmed"].ticket_number
        assert recorded["booking.cancelled"].reason == "Plans changed"
        assert recorded["booking.cancelled"].was_paid is True

    def test_a_gateway_payment(self, trip, alice, capture_events):
        from apps.payments.models import Payment
        from apps.payments.tests.conftest import deliver, signed

        booking = hold_and_book(client_for(alice), trip, "15").json()
        client_for(alice).post(f"/api/v1/bookings/{booking['id']}/checkout/")
        started = (
            client_for(alice)
            .post(
                "/api/v1/payments/", {"booking": booking["id"], "provider": "mock"}, format="json"
            )
            .json()
        )
        deliver(*signed(Payment.objects.get(pk=started["payment"]["id"])))

        recorded = events(capture_events)
        assert recorded["payment.started"].provider == "mock"
        assert recorded["payment.captured"].booking_confirmed is True
        assert recorded["payment.captured"].amount == f"{trip.base_price:.2f}"


class TestAdminActionsAreLogged:
    def test_an_admin_change_is_recorded(self, admin_api, capture_events):
        response = admin_api.post(
            "/api/v1/admin/stops/",
            {"name": "Negombo", "city": "Negombo", "latitude": "7.20", "longitude": "79.87"},
            format="json",
        )

        assert response.status_code == 201, response.content
        record = events(capture_events)["admin.action"]
        assert record.entity_type == "stop"
        assert record.actor_email


class TestTheLogItself:
    def test_events_render_as_json_with_their_fields(self):
        record = logging.LogRecord(
            EVENT_LOGGER, logging.INFO, __file__, 1, "booking.created", None, None
        )
        record.event = "booking.created"
        record.booking_reference = "YTABC23456"

        payload = json.loads(JSONFormatter().format(record))

        assert payload["logger"] == EVENT_LOGGER
        assert payload["event"] == "booking.created"
        assert payload["booking_reference"] == "YTABC23456"
        assert payload["request_id"] == "-"

    def test_a_field_can_never_overwrite_the_log_record(self, capture_events):
        # "message" and friends belong to logging; an event field of that name is dropped
        # rather than raising at the call site.
        log_event("test.event", message="ignored", name="ignored", booking_id="b1")

        record = events(capture_events)["test.event"]
        assert record.getMessage() == "test.event"
        assert record.name == EVENT_LOGGER
        assert record.booking_id == "b1"
