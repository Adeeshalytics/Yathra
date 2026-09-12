import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.bookings.models import BookingStatus, Passenger, SeatLock
from apps.core.tests.factories import BookingFactory
from apps.fleet.models import Bus, Seat
from apps.trips.models import Trip

from .conftest import LOCKS, client_for, local_datetime, lock, make_trip, seat_status

pytestmark = pytest.mark.django_db


def expire_all_locks():
    SeatLock.objects.update(expires_at=timezone.now() - timedelta(seconds=1))


class TestLocking:
    def test_locks_a_free_seat_for_five_minutes(self, trip, alice):
        response = lock(client_for(alice), trip, "15")

        assert response.status_code == 201, response.content
        body = response.json()
        assert [seat["seat_number"] for seat in body["seats"]] == ["15"]
        assert 295 <= body["seconds_remaining"] <= 300
        assert body["lock_minutes"] == 5
        assert body["quote"]["total"] == "2500.00"
        row = SeatLock.objects.get(trip=trip, seat_number="15")
        assert row.customer == alice
        assert (
            timedelta(minutes=4, seconds=55)
            < row.expires_at - timezone.now()
            <= timedelta(minutes=5)
        )

    def test_another_customer_cannot_take_a_locked_seat(self, trip, alice, bob):
        lock(client_for(alice), trip, "15")

        response = lock(client_for(bob), trip, "15")

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "seats_unavailable"
        assert error["details"] == {"seats": {"15": "locked"}}
        assert "15" in error["message"]

    def test_locking_is_all_or_nothing(self, trip, alice, bob):
        lock(client_for(alice), trip, "15")

        response = lock(client_for(bob), trip, "14", "15")

        assert response.status_code == 409
        assert not SeatLock.objects.filter(customer=bob).exists()

    def test_relocking_your_own_seat_changes_nothing(self, trip, alice):
        client = client_for(alice)
        first = lock(client, trip, "15").json()

        second = lock(client, trip, "15")

        assert second.status_code == 201
        assert second.json()["expires_at"] == first["expires_at"]
        assert SeatLock.objects.filter(trip=trip).count() == 1

    def test_all_your_seats_share_one_countdown(self, trip, alice):
        client = client_for(alice)
        first = lock(client, trip, "15").json()

        second = lock(client, trip, "16").json()

        assert [seat["seat_number"] for seat in second["seats"]] == ["15", "16"]
        assert second["expires_at"] == first["expires_at"]
        assert len({seat["expires_at"] for seat in second["seats"]}) == 1
        assert second["quote"]["total"] == "5000.00"

    @pytest.mark.parametrize(
        "seat", ["5", "6", "D", "41"], ids=["reserved", "blocked", "driver", "not-sold"]
    )
    def test_blocked_seats_cannot_be_locked(self, trip, bus, alice, seat):
        Seat.objects.filter(layout=bus.seat_layout, seat_number="5").update(seat_type="reserved")
        Seat.objects.filter(layout=bus.seat_layout, seat_number="6").update(is_available=False)
        Bus.objects.filter(pk=bus.pk).update(seat_capacity=30)

        response = lock(client_for(alice), trip, seat)

        assert response.status_code == 409
        assert response.json()["error"]["details"] == {"seats": {seat: "blocked"}}

    def test_booked_seats_cannot_be_locked(self, trip, alice):
        booking = BookingFactory(trip=trip, status=BookingStatus.CONFIRMED)
        Passenger.objects.create(booking=booking, name="Taken", seat_number="15")

        response = lock(client_for(alice), trip, "15")

        assert response.status_code == 409
        assert response.json()["error"]["details"] == {"seats": {"15": "booked"}}

    def test_seats_must_exist_on_the_bus(self, trip, alice):
        response = lock(client_for(alice), trip, "99")

        assert response.status_code == 400
        assert "seats" in response.json()["error"]["details"]

    def test_seat_numbers_are_matched_regardless_of_case(self, trip, alice):
        assert lock(client_for(alice), trip, " d ").json()["error"]["details"] == {
            "seats": {"D": "blocked"}
        }

    def test_a_customer_can_hold_at_most_ten_seats(self, trip, alice):
        client = client_for(alice)
        assert lock(client, trip, *[str(n) for n in range(1, 11)]).status_code == 201

        response = lock(client, trip, "11")

        assert response.status_code == 400
        assert SeatLock.objects.filter(customer=alice).count() == 10

    def test_only_trips_on_sale_can_be_locked(self, trip, alice):
        Trip.objects.filter(pk=trip.pk).update(active=False)

        assert lock(client_for(alice), trip, "15").status_code == 404

    def test_unknown_trip(self, route, alice):
        response = client_for(alice).post(
            LOCKS, {"trip": str(uuid.uuid4()), "seats": ["1"]}, format="json"
        )

        assert response.status_code == 404

    def test_needs_a_signed_in_customer(self, api_client, trip):
        assert lock(api_client, trip, "15").status_code == 401
        assert api_client.get(LOCKS, {"trip": str(trip.pk)}).status_code == 401


class TestExpiryAndRelease:
    def test_an_expired_lock_frees_the_seat(self, trip, alice, bob):
        lock(client_for(alice), trip, "15")
        expire_all_locks()

        response = lock(client_for(bob), trip, "15")

        assert response.status_code == 201
        assert SeatLock.objects.get(trip=trip, seat_number="15").customer == bob

    def test_expired_locks_do_not_show_on_the_seat_map(self, api_client, trip, alice):
        lock(client_for(alice), trip, "15")
        expire_all_locks()

        assert seat_status(api_client, trip, "15") == "available"

    def test_release_one_seat(self, trip, alice):
        client = client_for(alice)
        hold = lock(client, trip, "15", "16").json()
        seat_15 = next(seat for seat in hold["seats"] if seat["seat_number"] == "15")

        response = client.delete(f"{LOCKS}{seat_15['id']}/")

        assert response.status_code == 200
        assert [seat["seat_number"] for seat in response.json()["seats"]] == ["16"]

    def test_release_everything(self, trip, alice):
        client = client_for(alice)
        lock(client, trip, "15", "16")

        response = client.post(f"{LOCKS}release/", {"trip": str(trip.pk)}, format="json")

        assert response.json()["seats"] == []
        assert response.json()["quote"] is None
        assert not SeatLock.objects.exists()

    def test_you_cannot_release_someone_elses_lock(self, trip, alice, bob):
        hold = lock(client_for(alice), trip, "15").json()

        response = client_for(bob).delete(f"{LOCKS}{hold['seats'][0]['id']}/")

        assert response.status_code == 404
        assert SeatLock.objects.filter(customer=alice).exists()

    def test_the_hold_can_be_read_back(self, trip, alice):
        client = client_for(alice)
        lock(client, trip, "15")

        body = client.get(LOCKS, {"trip": str(trip.pk)}).json()

        assert [seat["seat_number"] for seat in body["seats"]] == ["15"]
        assert parse_datetime(body["expires_at"]) > timezone.now()

    def test_the_sweep_command_clears_expired_locks(self, trip, alice):
        lock(client_for(alice), trip, "15")
        expire_all_locks()

        output = StringIO()
        call_command("expire_seat_holds", stdout=output)

        assert "Released 1 expired seat lock(s)" in output.getvalue()

        assert not SeatLock.objects.exists()


class TestSeatMap:
    def test_shows_locks_to_everyone_and_marks_your_own(self, api_client, trip, alice, bob):
        lock(client_for(alice), trip, "15")
        url = f"/api/v1/trips/{trip.pk}/seats/"

        mine = client_for(alice).get(url).json()
        theirs = client_for(bob).get(url).json()
        anonymous = api_client.get(url).json()

        def seat(body):
            return next(s for s in body["seats"] if s["seat_number"] == "15")

        assert (seat(mine)["status"], seat(mine)["locked_by_me"]) == ("locked", True)
        assert (seat(theirs)["status"], seat(theirs)["locked_by_me"]) == ("locked", False)
        assert seat(anonymous)["status"] == "locked"
        assert [s["seat_number"] for s in mine["hold"]["seats"]] == ["15"]
        assert theirs["hold"]["seats"] == []
        assert anonymous["hold"] is None
        assert (mine["available_seats"], mine["locked_seats"]) == (40, 1)

    def test_availability_is_per_trip(self, route, bus, trip, alice, bob):
        later = make_trip(route, bus, local_datetime(6, 20, 30))  # same bus, another day
        booking = BookingFactory(trip=trip, status=BookingStatus.CONFIRMED)
        Passenger.objects.create(booking=booking, name="Taken", seat_number="15")
        lock(client_for(alice), trip, "16")

        assert seat_status(client_for(bob), trip, "15") == "booked"
        assert seat_status(client_for(bob), later, "15") == "available"
        assert seat_status(client_for(bob), later, "16") == "available"
        assert lock(client_for(bob), later, "15", "16").status_code == 201


class TestDatabaseGuards:
    def test_one_lock_per_seat(self, trip, alice, bob):
        expires = timezone.now() + timedelta(minutes=5)
        SeatLock.objects.create(trip=trip, customer=alice, seat_number="15", expires_at=expires)

        with pytest.raises(IntegrityError), transaction.atomic():
            SeatLock.objects.create(trip=trip, customer=bob, seat_number="15", expires_at=expires)

    def test_one_seat_holder_per_trip_seat(self, trip):
        first = BookingFactory(trip=trip, status=BookingStatus.CONFIRMED)
        Passenger.objects.create(booking=first, name="A", seat_number="15")
        released = BookingFactory(trip=trip, status=BookingStatus.CANCELLED)
        Passenger.objects.create(booking=released, name="B", seat_number="15")  # holds nothing
        second = BookingFactory(trip=trip, status=BookingStatus.CONFIRMED)

        with pytest.raises(IntegrityError), transaction.atomic():
            Passenger.objects.create(booking=second, name="C", seat_number="15")
