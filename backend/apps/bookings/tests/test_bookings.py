import re
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.bookings.models import Booking, Passenger, SeatLock
from apps.payments.models import Payment, PaymentStatus

from .conftest import (
    BOOKINGS,
    booking_payload,
    client_for,
    hold_and_book,
    lock,
    passenger,
    seat_status,
)

pytestmark = pytest.mark.django_db


def expire_bookings():
    Booking.objects.update(expires_at=timezone.now() - timedelta(seconds=1))


def url(booking: dict, suffix: str = "") -> str:
    return f"{BOOKINGS}{booking['id']}/{suffix}"


class TestCreating:
    def test_turns_held_seats_into_a_pending_booking(self, trip, alice, bob):
        client = client_for(alice)
        hold = lock(client, trip, "15", "16").json()

        response = client.post(BOOKINGS, booking_payload(trip, "15", "16"), format="json")

        assert response.status_code == 201, response.content
        body = response.json()
        assert body["status"] == "pending"
        assert re.fullmatch(r"YT[A-Z0-9]{8}", body["booking_reference"])
        assert body["customer"]["email"] == alice.email
        assert body["trip"]["id"] == str(trip.pk)
        assert body["seats"] == ["15", "16"]
        assert [p["seat_number"] for p in body["passengers"]] == ["15", "16"]
        assert body["passengers"][0]["name"] == "Kasuni Fernando"
        assert body["passengers"][0]["phone"].startswith("+94")
        assert body["passengers"][0]["email"] == "seat15@example.com"
        assert body["boarding"]["stop"]["name"] == "Colombo"
        assert body["dropoff"]["stop"]["name"] == "Batticaloa"
        assert body["price"] == {
            "currency": "LKR",
            "unit_price": "2500.00",
            "seats": 2,
            "subtotal": "5000.00",
            "service_fee": "0.00",
            "discount": "0.00",
            "tax": "0.00",
            "total": "5000.00",
        }
        # The booking keeps the seats' lock expiry as its own hold.
        held_until = parse_datetime(hold["expires_at"])
        assert abs(parse_datetime(body["expires_at"]) - held_until) < timedelta(seconds=1)
        assert 0 < body["seconds_remaining"] <= 300
        assert not SeatLock.objects.exists()
        assert seat_status(client_for(bob), trip, "15") == "booked"

    def test_part_of_the_route(self, trip, alice):
        body = hold_and_book(
            client_for(alice), trip, "15", boarding="Kurunegala", dropoff="Dambulla"
        ).json()

        assert (body["boarding"]["stop"]["name"], body["dropoff"]["stop"]["name"]) == (
            "Kurunegala",
            "Dambulla",
        )
        assert (
            timezone.localtime(parse_datetime(body["boarding"]["time"])).strftime("%H:%M")
            == "22:35"
        )
        assert body["price"]["total"] == "2500.00"

    def test_the_server_sets_the_price(self, trip, alice):
        client = client_for(alice)
        lock(client, trip, "15")
        payload = {**booking_payload(trip, "15"), "total_amount": "1.00", "unit_price": "1.00"}

        body = client.post(BOOKINGS, payload, format="json").json()

        assert body["total_amount"] == "2500.00"

    def test_seats_must_be_held_first(self, trip, alice):
        response = client_for(alice).post(BOOKINGS, booking_payload(trip, "15"), format="json")

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "hold_expired"
        assert error["details"] == {"seats": {"15": "not_held"}}

    def test_cannot_book_a_seat_someone_else_holds(self, trip, alice, bob):
        lock(client_for(bob), trip, "15")

        response = client_for(alice).post(BOOKINGS, booking_payload(trip, "15"), format="json")

        assert response.status_code == 409
        assert SeatLock.objects.filter(customer=bob, seat_number="15").exists()
        assert not Booking.objects.exists()

    def test_an_expired_hold_cannot_be_booked(self, trip, alice):
        client = client_for(alice)
        lock(client, trip, "15")
        SeatLock.objects.update(expires_at=timezone.now() - timedelta(seconds=1))

        response = client.post(BOOKINGS, booking_payload(trip, "15"), format="json")

        assert response.status_code == 409
        assert not Booking.objects.exists()

    def test_an_email_address_is_optional(self, trip, alice):
        # The ticket is texted to the phone; an e-mail address only adds an e-mail copy.
        client = client_for(alice)
        lock(client, trip, "15")
        without = {key: value for key, value in passenger("15").items() if key != "email"}

        response = client.post(
            BOOKINGS, booking_payload(trip, "15", passengers=[without]), format="json"
        )

        assert response.status_code == 201, response.content
        assert response.json()["passengers"][0]["email"] == ""

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"passengers": [{**passenger("15"), "email": "not-an-email"}]}, "passengers"),
            ({"passengers": [{**passenger("15"), "phone": "12"}]}, "passengers"),
            ({"passengers": [{**passenger("15"), "phone": ""}]}, "passengers"),
            ({"passengers": [{**passenger("15"), "name": " "}]}, "passengers"),
            ({"passengers": [passenger("15"), passenger("15")]}, "passengers"),
            ({"passengers": []}, "passengers"),
            ({"boarding": "Batticaloa"}, "boarding_stop"),
            ({"boarding": "Dambulla", "dropoff": "Kurunegala"}, "dropoff_stop"),
            ({"boarding": "Kurunegala", "dropoff": "Kurunegala"}, "dropoff_stop"),
            ({"dropoff": "Colombo"}, "dropoff_stop"),
        ],
    )
    def test_rejects_incomplete_or_impossible_bookings(self, trip, alice, overrides, field):
        client = client_for(alice)
        lock(client, trip, "15")

        response = client.post(BOOKINGS, booking_payload(trip, "15", **overrides), format="json")

        assert response.status_code == 400
        assert field in response.json()["error"]["details"]
        assert SeatLock.objects.filter(customer=alice).exists()  # the hold survives a typo


class TestLifeCycle:
    def test_review_payment_and_confirmation(self, trip, alice, bob, staff):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15", "16").json()

        submitted = client.post(url(booking, "checkout/"))
        again = client.post(url(booking, "checkout/"))
        confirmed = client_for(staff).post(url(booking, "confirm/"), {"payment_method": "cash"})
        twice = client_for(staff).post(url(booking, "confirm/"))

        assert submitted.json()["status"] == "payment_pending"
        assert again.status_code == 409
        assert seat_status(client_for(bob), trip, "15") == "booked"
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "confirmed"
        assert confirmed.json()["confirmed_at"]
        assert confirmed.json()["seconds_remaining"] is None
        payment = Payment.objects.get(booking_id=booking["id"])
        assert (payment.provider, payment.status, str(payment.amount), payment.payment_method) == (
            "manual",
            PaymentStatus.SUCCESSFUL,
            "5000.00",
            "cash",
        )
        assert confirmed.json()["ticket"]["ticket_number"].startswith("TK")
        assert twice.status_code == 409

    def test_only_staff_record_payments(self, trip, alice):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15").json()

        assert client.post(url(booking, "confirm/")).status_code == 403

    def test_a_hold_that_runs_out_expires_and_frees_the_seats(self, trip, alice, bob):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15").json()
        expire_bookings()

        detail = client.get(url(booking)).json()

        assert detail["status"] == "expired"
        assert detail["seconds_remaining"] is None
        assert lock(client_for(bob), trip, "15").status_code == 201
        response = client.post(url(booking, "checkout/"))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "hold_expired"

    def test_payment_after_the_hold_ran_out_is_refused(self, trip, alice, staff):
        booking = hold_and_book(client_for(alice), trip, "15").json()
        expire_bookings()

        response = client_for(staff).post(url(booking, "confirm/"))

        assert response.status_code == 409
        assert Booking.objects.get(pk=booking["id"]).status == "expired"
        assert not Payment.objects.exists()

    def test_the_sweep_command_expires_unpaid_bookings(self, trip, alice):
        booking = hold_and_book(client_for(alice), trip, "15").json()
        expire_bookings()

        call_command("expire_seat_holds")

        assert Booking.objects.get(pk=booking["id"]).status == "expired"
        assert not Passenger.objects.filter(holds_seat=True).exists()

    def test_customers_cancel_before_paying(self, trip, alice, bob):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15").json()

        body = client.post(url(booking, "cancel/"), {"reason": "Plans changed"}).json()

        assert (body["status"], body["cancellation_reason"]) == ("cancelled", "Plans changed")
        assert lock(client_for(bob), trip, "15").status_code == 201

    def test_paid_bookings_follow_the_cancellation_policy(self, trip, alice, staff):
        """Phase 6: customers cancel their own paid bookings when the policy allows it."""
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15").json()
        client_for(staff).post(url(booking, "confirm/"))

        cancelled = client.post(url(booking, "cancel/"), {"reason": "Plans changed"})

        assert cancelled.status_code == 200, cancelled.content
        body = cancelled.json()
        assert (body["status"], body["cancellation_reason"]) == ("cancelled", "Plans changed")
        # The trip is days away, so the top tier applies and the full fare is queued back.
        [refund] = body["refunds"]
        assert (refund["status"], refund["amount"]) == ("requested", "2500.00")

    def test_correcting_passenger_details(self, trip, alice):
        client = client_for(alice)
        booking = hold_and_book(client, trip, "15").json()

        fixed = client.patch(
            url(booking), {"passengers": [passenger("15", "Nimal Silva")]}, format="json"
        )
        wrong_seat = client.patch(url(booking), {"passengers": [passenger("16")]}, format="json")
        client.post(url(booking, "checkout/"))
        too_late = client.patch(url(booking), {"passengers": [passenger("15")]}, format="json")

        assert fixed.json()["passengers"][0]["name"] == "Nimal Silva"
        assert wrong_seat.status_code == 400
        assert too_late.status_code == 409

    def test_cancelling_the_trip_cancels_its_bookings(self, trip, alice, bob, staff):
        booking = hold_and_book(client_for(alice), trip, "15").json()
        lock(client_for(bob), trip, "20")

        client_for(staff).post(f"/api/v1/admin/trips/{trip.pk}/cancel/", {"reason": "Floods"})

        cancelled = Booking.objects.get(pk=booking["id"])
        assert (cancelled.status, cancelled.cancellation_reason) == ("cancelled", "Floods")
        assert not Passenger.objects.filter(holds_seat=True).exists()
        assert not SeatLock.objects.exists()

    def test_finished_trips_complete_their_paid_bookings(self, trip, alice, bob, staff):
        paid = hold_and_book(client_for(alice), trip, "15").json()
        unpaid = hold_and_book(client_for(bob), trip, "16").json()
        admin = client_for(staff)
        admin.post(url(paid, "confirm/"))

        for status in ("boarding", "departed", "completed"):
            admin.post(f"/api/v1/admin/trips/{trip.pk}/status/", {"status": status})

        assert Booking.objects.get(pk=paid["id"]).status == "completed"
        assert Booking.objects.get(pk=unpaid["id"]).status == "expired"


class TestAccess:
    def test_customers_see_only_their_own_bookings(self, trip, alice, bob):
        mine = hold_and_book(client_for(alice), trip, "15").json()
        theirs = hold_and_book(client_for(bob), trip, "16").json()
        client = client_for(alice)

        listed = client.get(BOOKINGS).json()

        assert [b["booking_reference"] for b in listed["results"]] == [mine["booking_reference"]]
        assert client.get(url(theirs)).status_code == 404
        assert (
            client.patch(url(theirs), {"passengers": [passenger("16")]}, format="json").status_code
            == 404
        )
        assert client.post(url(theirs, "checkout/")).status_code == 404
        assert client.post(url(theirs, "cancel/")).status_code == 404

    def test_admins_see_every_booking(self, trip, alice, bob, staff):
        hold_and_book(client_for(alice), trip, "15")
        theirs = hold_and_book(client_for(bob), trip, "16").json()
        admin = client_for(staff)

        assert admin.get(BOOKINGS).json()["count"] == 2
        assert admin.get(url(theirs)).json()["customer"]["email"] == bob.email

    def test_anonymous_visitors_are_turned_away(self, api_client, trip):
        assert api_client.get(BOOKINGS).status_code == 401
        assert (
            api_client.post(BOOKINGS, booking_payload(trip, "15"), format="json").status_code == 401
        )
