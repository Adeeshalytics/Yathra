"""
Real races: several threads, each with its own database connection, hit the booking engine
at the same instant. These run with committed transactions (not the usual rolled-back test
transaction), so the row locks and constraints behave exactly as in production.
"""

import threading

import pytest
from django.db import connection

from apps.bookings.models import Booking, Passenger, SeatLock
from apps.bookings.services import SeatsUnavailable, create_booking, lock_seats
from apps.core.tests.factories import CustomerFactory

from .conftest import build_trip

pytestmark = pytest.mark.django_db(transaction=True)


def race(actions):
    """Start every callable at the same moment in its own thread; return what each gave back."""
    barrier = threading.Barrier(len(actions))
    outcomes = [None] * len(actions)

    def run(index, action):
        try:
            barrier.wait(timeout=10)
            outcomes[index] = action()
        except Exception as exc:
            outcomes[index] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=item) for item in enumerate(actions)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    return outcomes


def locker(trip, customer, *seats):
    return lambda: lock_seats(trip_id=trip.pk, customer=customer, seat_numbers=list(seats))


def winners(outcomes):
    return [outcome for outcome in outcomes if isinstance(outcome, list)]


def refusals(outcomes):
    return [outcome for outcome in outcomes if isinstance(outcome, SeatsUnavailable)]


def test_two_customers_clicking_the_same_seat_at_once():
    trip = build_trip()
    alice, bob = CustomerFactory(), CustomerFactory()

    outcomes = race([locker(trip, alice, "15"), locker(trip, bob, "15")])

    assert (len(winners(outcomes)), len(refusals(outcomes))) == (1, 1)
    assert refusals(outcomes)[0].details == {"seats": {"15": "locked"}}
    [winner] = winners(outcomes)
    assert SeatLock.objects.filter(trip=trip, seat_number="15").count() == 1
    assert SeatLock.objects.get(trip=trip, seat_number="15").customer_id == winner[0].customer_id


def test_a_crowd_racing_for_one_seat():
    trip = build_trip()
    customers = [CustomerFactory() for _ in range(8)]

    outcomes = race([locker(trip, customer, "15") for customer in customers])

    assert (len(winners(outcomes)), len(refusals(outcomes))) == (1, 7)
    assert SeatLock.objects.filter(trip=trip).count() == 1


def test_different_seats_do_not_get_in_each_others_way():
    trip = build_trip()
    customers = [CustomerFactory() for _ in range(6)]

    outcomes = race([locker(trip, c, str(n)) for n, c in enumerate(customers, start=1)])

    assert len(winners(outcomes)) == 6
    assert SeatLock.objects.filter(trip=trip).count() == 6


def test_overlapping_multi_seat_requests_are_all_or_nothing():
    trip = build_trip()
    alice, bob = CustomerFactory(), CustomerFactory()

    outcomes = race([locker(trip, alice, "14", "15"), locker(trip, bob, "15", "16")])

    [winner] = winners(outcomes)
    locks = SeatLock.objects.filter(trip=trip)
    assert locks.count() == 2
    assert {lock.customer_id for lock in locks} == {winner[0].customer_id}


def test_booking_while_someone_else_grabs_the_seat():
    trip = build_trip()
    alice, bob = CustomerFactory(), CustomerFactory()
    lock_seats(trip_id=trip.pk, customer=alice, seat_numbers=["15"])
    stops = {stop.stop.name: stop.stop_id for stop in trip.trip_stops.select_related("stop")}

    def book():
        return create_booking(
            customer=alice,
            trip_id=trip.pk,
            boarding_stop_id=stops["Colombo"],
            dropoff_stop_id=stops["Batticaloa"],
            passengers=[
                {"seat_number": "15", "name": "Alice", "phone": "+94771234567", "email": "a@x.lk"}
            ],
        )

    outcomes = race([book, locker(trip, bob, "15")])

    assert isinstance(outcomes[0], Booking)
    assert isinstance(outcomes[1], SeatsUnavailable)
    assert Passenger.objects.filter(trip=trip, seat_number="15", holds_seat=True).count() == 1
    assert not SeatLock.objects.filter(trip=trip).exists()
