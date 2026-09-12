import base64

import pytest

from apps.bookings.tests.conftest import BOOKINGS, client_for, hold_and_book
from apps.core.tests.factories import OperatorMembershipFactory
from apps.tickets.models import Ticket
from apps.tickets.qr import qr_svg, read_ticket_code, ticket_code
from apps.tickets.services import issue_ticket

pytestmark = pytest.mark.django_db

VERIFY = "/api/v1/tickets/verify/"


def confirmed(customer, admin, on_trip, *seats) -> dict:
    """A booking paid at the counter (so it has an e-ticket)."""
    booking = hold_and_book(client_for(customer), on_trip, *(seats or ("15",))).json()
    response = client_for(admin).post(f"{BOOKINGS}{booking['id']}/confirm/")
    assert response.status_code == 200, response.content
    return response.json()


def ticket_url(booking: dict, suffix: str = "") -> str:
    return f"{BOOKINGS}{booking['id']}/ticket/{suffix}"


class TestTicketPage:
    def test_a_confirmed_booking_has_an_e_ticket(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip, "15", "16")

        body = client_for(alice).get(ticket_url(booking)).json()

        assert body["ticket_number"] == booking["ticket"]["ticket_number"]
        assert (body["status"], body["status_label"], body["is_valid"]) == ("valid", "Valid", True)
        assert body["booking"]["booking_reference"] == booking["booking_reference"]
        assert body["booking"]["seats"] == ["15", "16"]
        assert body["payment"]["payment_method_label"] == "Cash"
        assert body["qr_code"].startswith("data:image/svg+xml;base64,")
        svg = base64.b64decode(body["qr_code"].split(",", 1)[1]).decode()
        assert svg.startswith("<svg") and "<path" in svg

    def test_the_qr_code_holds_only_a_signed_ticket_number(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)
        number = booking["ticket"]["ticket_number"]

        code = ticket_code(number)

        assert code.startswith(f"{number}:")
        for private in (alice.name, alice.email, "077", "+94", booking["booking_reference"]):
            assert private not in code
        assert read_ticket_code(code) == number
        assert read_ticket_code(code[:-1] + ("A" if code[-1] != "A" else "B")) is None
        assert read_ticket_code(f"{number}:forged") is None

    def test_no_ticket_before_payment(self, trip, alice):
        booking = hold_and_book(client_for(alice), trip, "15").json()

        response = client_for(alice).get(ticket_url(booking))

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "ticket_not_issued"

    def test_customers_see_only_their_own_tickets(self, trip, alice, bob, staff):
        booking = confirmed(alice, staff, trip)

        assert client_for(bob).get(ticket_url(booking)).status_code == 404
        assert client_for(bob).get(ticket_url(booking, "pdf/")).status_code == 404
        assert client_for(staff).get(ticket_url(booking)).status_code == 200

    def test_a_cancelled_booking_voids_its_ticket(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)
        client_for(staff).post(f"{BOOKINGS}{booking['id']}/cancel/", {"reason": "Refund"})

        body = client_for(alice).get(ticket_url(booking)).json()

        assert (body["status"], body["is_valid"]) == ("cancelled", False)

    def test_issuing_is_idempotent(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)
        ticket = Ticket.objects.get(booking_id=booking["id"])

        assert issue_ticket(ticket.booking) == ticket
        assert Ticket.objects.count() == 1


class TestPdf:
    def test_downloads_a_pdf_ticket(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip, "15", "16")

        response = client_for(alice).get(ticket_url(booking, "pdf/"))

        assert response.status_code == 200
        assert response["Content-Type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")
        assert f"ticket-{booking['booking_reference']}.pdf" in response["Content-Disposition"]
        assert response["Cache-Control"] == "private, no-store"

    def test_honours_a_pdf_accept_header(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)

        response = client_for(alice).get(ticket_url(booking, "pdf/"), HTTP_ACCEPT="application/pdf")

        assert response.content.startswith(b"%PDF")

    def test_draws_cancelled_tickets_too(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)
        client_for(staff).post(f"{BOOKINGS}{booking['id']}/cancel/", {"reason": "x"})

        response = client_for(alice).get(ticket_url(booking, "pdf/"))

        assert response.content.startswith(b"%PDF")


class TestScanning:
    def test_admins_check_a_scanned_ticket(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip, "15")
        code = ticket_code(booking["ticket"]["ticket_number"])

        body = client_for(staff).get(VERIFY, {"code": code}).json()

        assert (body["is_valid"], body["status"]) == (True, "valid")
        assert body["booking_reference"] == booking["booking_reference"]
        assert body["passengers"] == [{"seat_number": "15", "name": "Kasuni Fernando"}]
        assert body["trip"]["bus"] == "WP NC-4521"
        assert "phone" not in str(body) and "email" not in str(body)

    def test_a_typed_ticket_number_works_for_damaged_printouts(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)

        body = client_for(staff).get(VERIFY, {"code": booking["ticket"]["ticket_number"]})

        assert body.json()["is_valid"] is True

    def test_a_forged_code_matches_nothing(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)

        forged = client_for(staff).get(
            VERIFY, {"code": f"{booking['ticket']['ticket_number']}:not-our-signature"}
        )
        empty = client_for(staff).get(VERIFY, {"code": " "})

        assert forged.status_code == 404
        assert forged.json()["error"]["code"] == "ticket_not_found"
        assert empty.status_code == 400

    def test_a_cancelled_ticket_scans_as_invalid(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)
        client_for(staff).post(f"{BOOKINGS}{booking['id']}/cancel/", {"reason": "x"})

        body = (
            client_for(staff)
            .get(VERIFY, {"code": ticket_code(booking["ticket"]["ticket_number"])})
            .json()
        )

        assert (body["is_valid"], body["status"]) == (False, "cancelled")

    def test_operators_check_only_their_own_trips(self, trip, alice, staff):
        booking = confirmed(alice, staff, trip)
        code = ticket_code(booking["ticket"]["ticket_number"])
        own = OperatorMembershipFactory(operator=trip.operator).user
        other = OperatorMembershipFactory().user

        assert client_for(own).get(VERIFY, {"code": code}).status_code == 200
        assert client_for(other).get(VERIFY, {"code": code}).status_code == 404
        assert client_for(alice).get(VERIFY, {"code": code}).status_code == 403


def test_qr_svg_is_compact():
    svg = qr_svg("TKABCDEFGH23:" + "x" * 43)

    assert svg.count("<path") == 1
    assert len(svg) < 6000
