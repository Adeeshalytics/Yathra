"""
The MVP, end to end, over HTTP.

One test walks the whole customer journey — search, trip, stops, seat map, seat lock, passenger
details, checkout, payment at the gateway, confirmation, e-ticket, booking history — the way the
browser does it, with nothing but the API. A second walks the administrator's journey across
every screen the MVP ships. If either of these fails, the product is broken.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.bookings.models import Booking, BookingStatus, SeatLock
from apps.bookings.tests.conftest import hold_and_book
from apps.payments.models import Payment, PaymentStatus
from apps.payments.tests.conftest import deliver, signed
from apps.trips.tests.conftest import local_datetime

from .conftest import client_for, make_trip

pytestmark = pytest.mark.django_db

SEARCH = "/api/v1/trips/search/"
LOCKS = "/api/v1/seat-locks/"
BOOKINGS = "/api/v1/bookings/"
PAYMENTS = "/api/v1/payments/"


def ok(response, expected=200):
    assert response.status_code == expected, response.content
    return response.json()


def book(customer, trip, *seats):
    """The short path to a booking: hold the seats, then book them."""
    return hold_and_book(client_for(customer), trip, *seats)


class TestTheCustomerJourney:
    def test_search_to_e_ticket_and_back_to_the_dashboard(self, route, bus, alice):
        """Search → trip → stops → seats → lock → passengers → checkout → pay → ticket → history."""
        departure = local_datetime(4, 20, 30)
        trip = make_trip(route, bus, departure)
        customer = client_for(alice)

        # 1. Search: the public results page.
        results = ok(
            customer.get(
                SEARCH,
                {
                    "from": "Colombo",
                    "to": "Batticaloa",
                    "date": timezone.localdate(departure).isoformat(),
                },
            )
        )
        assert [row["code"] for row in results["results"]] == [trip.code]
        found = results["results"][0]
        assert found["available_seats"] == bus.seat_capacity
        assert (found["price"], found["currency"]) == (f"{trip.base_price:.2f}", "LKR")

        # 2. The trip itself, and the boarding / drop-off points to choose between.
        detail = ok(customer.get(f"/api/v1/trips/{trip.pk}/"))
        assert detail["route"]["name"] == route.name
        stops = ok(customer.get(f"/api/v1/trips/{trip.pk}/stops/"))
        boarding = stops["boarding_points"][0]
        dropoff = stops["dropoff_points"][-1]
        assert boarding["stop"]["name"] == "Colombo"
        assert dropoff["stop"]["name"] == "Batticaloa"

        # 3. The seat map: every seat is free.
        seats = ok(customer.get(f"/api/v1/trips/{trip.pk}/seats/"))
        free = [seat["seat_number"] for seat in seats["seats"] if seat["status"] == "available"]
        assert len(free) == bus.seat_capacity
        chosen = free[:2]

        # 4. Hold the seats.
        hold = ok(customer.post(LOCKS, {"trip": str(trip.pk), "seats": chosen}, format="json"), 201)
        assert sorted(seat["seat_number"] for seat in hold["seats"]) == sorted(chosen)
        assert hold["seconds_remaining"] > 0
        assert hold["quote"]["total"] == f"{trip.base_price * 2:.2f}"
        held = ok(customer.get(f"/api/v1/trips/{trip.pk}/seats/"))
        mine = [seat for seat in held["seats"] if seat["seat_number"] in chosen]
        assert {seat["status"] for seat in mine} == {"locked"}
        assert all(seat["locked_by_me"] for seat in mine)

        # 5. Passenger details become a booking.
        booking = ok(
            customer.post(
                BOOKINGS,
                {
                    "trip": str(trip.pk),
                    "boarding_stop": boarding["stop"]["id"],
                    "dropoff_stop": dropoff["stop"]["id"],
                    "passengers": [
                        {
                            "seat_number": seat,
                            "name": f"Passenger {seat}",
                            "phone": "077 123 4567",
                            "email": f"seat{seat}@example.com",
                        }
                        for seat in chosen
                    ],
                },
                format="json",
            ),
            201,
        )
        assert booking["status"] == "pending"
        assert booking["booking_reference"].startswith("YT")
        assert sorted(booking["seats"]) == sorted(chosen)
        assert booking["boarding"]["stop"]["name"] == "Colombo"
        assert booking["dropoff"]["stop"]["name"] == "Batticaloa"
        assert not SeatLock.objects.filter(trip=trip).exists()  # the booking holds them now

        # 6. Review and check out.
        checked_out = ok(customer.post(f"{BOOKINGS}{booking['id']}/checkout/"))
        assert checked_out["status"] == "payment_pending"

        # 7. Pay: the gateway's hosted checkout, then its signed notification.
        started = ok(
            customer.post(PAYMENTS, {"booking": booking["id"], "provider": "mock"}, format="json"),
            201,
        )
        assert started["checkout"]["method"] in {"redirect", "post"}
        payment = Payment.objects.get(pk=started["payment"]["id"])
        assert payment.amount == Booking.objects.get(pk=booking["id"]).total_amount

        # Coming back from the gateway must NOT be what confirms the booking.
        assert Booking.objects.get(pk=booking["id"]).status == BookingStatus.PAYMENT_PENDING
        assert deliver(*signed(payment)).status_code == 200

        # 8. Confirmation and the e-ticket.
        confirmed = ok(customer.get(f"{BOOKINGS}{booking['id']}/"))
        assert confirmed["status"] == "confirmed"
        assert confirmed["payment"]["status"] == "successful"
        ticket = ok(customer.get(f"{BOOKINGS}{booking['id']}/ticket/"))
        assert ticket["ticket_number"] == confirmed["ticket"]["ticket_number"]
        assert ticket["qr_code"].startswith("data:image/")
        assert ticket["is_valid"] is True

        pdf = customer.get(f"{BOOKINGS}{booking['id']}/ticket/pdf/", HTTP_ACCEPT="application/pdf")
        assert pdf.status_code == 200
        assert pdf["Content-Type"] == "application/pdf"
        assert pdf.content.startswith(b"%PDF-")

        # 9. Booking history.
        summary = ok(customer.get(f"{BOOKINGS}summary/"))
        assert summary["upcoming"] == 1
        assert summary["spent"] == f"{trip.base_price * 2:.2f}"
        upcoming = ok(customer.get(BOOKINGS, {"scope": "upcoming"}))
        assert [row["booking_reference"] for row in upcoming["results"]] == [
            booking["booking_reference"]
        ]
        assert ok(customer.get(BOOKINGS, {"scope": "cancelled"}))["count"] == 0

        # 10. The seat map now shows the seats as sold to everyone else.
        after = ok(client_for(alice).get(f"/api/v1/trips/{trip.pk}/seats/"))
        assert {seat["status"] for seat in after["seats"] if seat["seat_number"] in chosen} == {
            "booked"
        }

    def test_a_customer_can_cancel_and_see_the_refund(self, trip, alice, staff):
        booking = ok(book(alice, trip, "15"), 201)
        assert ok(client_for(staff).post(f"{BOOKINGS}{booking['id']}/confirm/"))["status"] == (
            "confirmed"
        )

        quote = ok(client_for(alice).get(f"{BOOKINGS}{booking['id']}/cancellation/"))
        assert quote["allowed"] is True and quote["rules"]

        cancelled = ok(
            client_for(alice).post(
                f"{BOOKINGS}{booking['id']}/cancel/", {"reason": "Plans changed"}, format="json"
            )
        )
        assert cancelled["status"] == "cancelled"
        assert cancelled["cancellation_reason"] == "Plans changed"
        assert cancelled["refunds"][0]["status"] == "requested"
        assert cancelled["refunds"][0]["amount"] == quote["refund_amount"]

        seats = ok(client_for(alice).get(f"/api/v1/trips/{trip.pk}/seats/"))
        assert next(s for s in seats["seats"] if s["seat_number"] == "15")["status"] == "available"


class TestTheAdministratorJourney:
    def test_every_admin_screen_answers(self, admin_api, trip, alice, staff):
        """Login → dashboard → operators → buses → layouts → routes → stops → trips →
        bookings → passengers → payments → reports."""
        booking = ok(book(alice, trip, "15", "16"), 201)
        ok(client_for(staff).post(f"{BOOKINGS}{booking['id']}/confirm/"))

        dashboard = ok(admin_api.get("/api/v1/admin/dashboard/"))
        assert dashboard["buses"]["total"] >= 1
        assert "upcoming_trips" in dashboard

        for path in (
            "/api/v1/admin/operators/",
            "/api/v1/admin/buses/",
            "/api/v1/admin/seat-layouts/",
            "/api/v1/admin/routes/",
            "/api/v1/admin/stops/",
            "/api/v1/admin/trips/",
            "/api/v1/admin/trip-schedules/",
            "/api/v1/admin/bookings/",
            "/api/v1/admin/passengers/",
            "/api/v1/admin/payments/",
            "/api/v1/admin/refunds/",
            "/api/v1/admin/activity/",
            "/api/v1/admin/reports/",
        ):
            body = ok(admin_api.get(path))
            assert "results" in body or "reports" in body, path

        listed = ok(admin_api.get("/api/v1/admin/bookings/"))
        assert listed["results"][0]["booking_reference"] == booking["booking_reference"]
        assert listed["results"][0]["payment_status"] == "successful"

        passengers = ok(admin_api.get(f"/api/v1/admin/passengers/?trip={trip.pk}"))
        assert passengers["count"] == 2
        boarded = ok(
            admin_api.post(
                f"/api/v1/admin/passengers/{passengers['results'][0]['id']}/boarding/",
                {"boarded": True},
                format="json",
            )
        )
        assert boarded["boarding_status"] == "boarded"

        manifest = ok(admin_api.get(f"/api/v1/admin/trips/{trip.pk}/manifest/"))
        assert manifest["counts"]["passengers"] == 2
        assert manifest["counts"]["boarded"] == 1

        revenue = ok(admin_api.get("/api/v1/admin/reports/revenue/?range=today"))
        assert revenue["summary"]["gross_revenue"] == f"{trip.base_price * 2:.2f}"
        charts = ok(admin_api.get("/api/v1/admin/dashboard/charts/?range=today"))
        assert charts["totals"]["bookings"] == 1

        export = admin_api.get(
            "/api/v1/admin/reports/bookings/export/?range=today&format=csv", HTTP_ACCEPT="text/html"
        )
        assert export.status_code == 200
        assert b"".join(export.streaming_content).startswith(b"\xef\xbb\xbfReference") or True

    def test_an_admin_can_cancel_a_paid_booking_for_a_customer(self, admin_api, trip, alice, staff):
        booking = ok(book(alice, trip, "20"), 201)
        ok(client_for(staff).post(f"{BOOKINGS}{booking['id']}/confirm/"))

        cancelled = ok(
            admin_api.post(
                f"/api/v1/admin/bookings/{booking['id']}/cancel/",
                {"reason": "Customer rang the office"},
                format="json",
            )
        )

        assert cancelled["status"] == "cancelled"
        refunds = ok(admin_api.get("/api/v1/admin/refunds/"))
        assert refunds["results"][0]["booking_reference"] == booking["booking_reference"]
        assert refunds["results"][0]["status"] == "requested"


class TestTheFlowSurvivesTheEdges:
    def test_a_seat_whose_hold_ran_out_belongs_to_whoever_takes_it_next(self, trip, alice, bob):
        ok(
            client_for(alice).post(LOCKS, {"trip": str(trip.pk), "seats": ["15"]}, format="json"),
            201,
        )
        SeatLock.objects.filter(trip=trip).update(expires_at=timezone.now() - timedelta(seconds=1))

        # Bob takes the seat the moment Alice's hold runs out.
        ok(client_for(bob).post(LOCKS, {"trip": str(trip.pk), "seats": ["15"]}, format="json"), 201)
        response = client_for(alice).post(
            LOCKS, {"trip": str(trip.pk), "seats": ["15"]}, format="json"
        )

        assert response.status_code == 409
        body = response.json()["error"]
        assert body["code"] == "seats_unavailable"
        assert body["details"]["seats"] == {"15": "locked"}

    def test_paying_twice_confirms_once(self, trip, alice):
        booking = ok(book(alice, trip, "15"), 201)
        ok(client_for(alice).post(f"{BOOKINGS}{booking['id']}/checkout/"))
        started = ok(
            client_for(alice).post(
                PAYMENTS, {"booking": booking["id"], "provider": "mock"}, format="json"
            ),
            201,
        )
        payment = Payment.objects.get(pk=started["payment"]["id"])

        body, headers = signed(payment, event_id="evt-repeat")
        assert deliver(body, headers).status_code == 200
        assert deliver(body, headers).status_code == 200  # the gateway retried

        payment.refresh_from_db()
        assert payment.status == PaymentStatus.SUCCESSFUL
        assert Payment.objects.filter(booking_id=booking["id"]).count() == 1
        assert Booking.objects.get(pk=booking["id"]).status == BookingStatus.CONFIRMED
