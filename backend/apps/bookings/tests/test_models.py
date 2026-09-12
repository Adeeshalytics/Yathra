import re
from decimal import Decimal
from unittest import mock

import pytest
from django.db import IntegrityError, transaction

from apps.bookings.models import Passenger
from apps.core.tests.factories import (
    BookingFactory,
    BusFactory,
    RouteFactory,
    StopFactory,
    TripFactory,
)
from apps.payments.models import Payment, PaymentMethod, PaymentStatus

pytestmark = pytest.mark.django_db


def test_booking_gets_a_readable_unique_reference():
    booking = BookingFactory()

    assert re.fullmatch(r"YT[A-HJKMNP-Z2-9]{8}", booking.booking_reference)


def test_reference_collision_is_retried_without_breaking_the_transaction():
    existing = BookingFactory()
    references = iter([existing.booking_reference, "YTFRESH234"])

    with (
        transaction.atomic(),
        mock.patch("apps.bookings.models.generate_booking_reference", lambda: next(references)),
    ):
        booking = BookingFactory()

    assert booking.booking_reference == "YTFRESH234"


def test_a_seat_appears_once_per_booking():
    booking = BookingFactory()
    Passenger.objects.create(booking=booking, name="A", seat_number="12")

    with pytest.raises(IntegrityError), transaction.atomic():
        Passenger.objects.create(booking=booking, name="B", seat_number="12")


def test_bus_cannot_be_double_booked_for_the_same_departure():
    trip = TripFactory()

    with pytest.raises(IntegrityError), transaction.atomic():
        TripFactory(bus=trip.bus, departure_datetime=trip.departure_datetime)


def test_route_endpoints_must_differ():
    stop = StopFactory()

    with pytest.raises(IntegrityError), transaction.atomic():
        RouteFactory(origin=stop, destination=stop)


def test_bus_seat_capacity_is_bounded():
    with pytest.raises(IntegrityError), transaction.atomic():
        BusFactory(seat_capacity=0)


def test_successful_payment_requires_paid_at():
    booking = BookingFactory()

    with pytest.raises(IntegrityError), transaction.atomic():
        Payment.objects.create(
            booking=booking,
            provider="mock",
            amount=Decimal("1000.00"),
            status=PaymentStatus.SUCCESSFUL,
            payment_method=PaymentMethod.CARD,
        )


def test_payment_gets_a_transaction_reference():
    payment = Payment.objects.create(
        booking=BookingFactory(), provider="mock", amount=Decimal("10.00")
    )

    assert payment.transaction_reference.startswith("TXN")
    assert (payment.status, payment.payment_method) == (PaymentStatus.PENDING, "")


def test_payment_needs_a_provider():
    with pytest.raises(IntegrityError), transaction.atomic():
        Payment.objects.create(booking=BookingFactory(), amount=Decimal("10.00"))


def test_a_booking_has_one_open_payment_at_a_time():
    booking = BookingFactory()
    Payment.objects.create(booking=booking, provider="mock", amount=Decimal("10.00"))

    with pytest.raises(IntegrityError), transaction.atomic():
        Payment.objects.create(
            booking=booking,
            provider="mock",
            amount=Decimal("10.00"),
            status=PaymentStatus.PROCESSING,
        )


def test_refunds_cannot_exceed_the_payment():
    with pytest.raises(IntegrityError), transaction.atomic():
        Payment.objects.create(
            booking=BookingFactory(),
            provider="mock",
            amount=Decimal("10.00"),
            refunded_amount=Decimal("10.01"),
            status=PaymentStatus.REFUNDED,
            paid_at="2030-01-01T10:00:00+05:30",
        )
