import itertools
from datetime import timedelta
from decimal import Decimal

import factory
from django.utils import timezone

from apps.accounts.models import User, UserRole
from apps.bookings.models import Booking
from apps.fleet.models import Bus, Seat, SeatLayout
from apps.fleet.seat_layouts import generate_layout
from apps.operators.models import Operator, OperatorMemberRole, OperatorMembership, OperatorStatus
from apps.routes.models import Route, RouteStop, Stop
from apps.trips.models import Trip


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
        skip_postgeneration_save = True

    name = factory.Faker("name")
    email = factory.Sequence(lambda n: f"user{n}@example.com")
    phone = factory.Sequence(lambda n: f"+9477{n:07d}")
    role = UserRole.CUSTOMER

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        self.set_password(extracted or "Str0ng-Test-Pass!")
        if create:
            self.save(update_fields=["password"])


class CustomerFactory(UserFactory):
    role = UserRole.CUSTOMER


class OperatorUserFactory(UserFactory):
    role = UserRole.OPERATOR


class AdminFactory(UserFactory):
    role = UserRole.ADMIN
    is_staff = True


class OperatorFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Operator

    company_name = factory.Sequence(lambda n: f"Test Coaches {n}")
    registration_number = factory.Sequence(lambda n: f"PV-{n:08d}")
    contact_phone = "+94112345678"
    contact_email = factory.Sequence(lambda n: f"ops{n}@operator.example")
    address = "1 Main Street, Colombo"
    status = OperatorStatus.ACTIVE


class OperatorMembershipFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = OperatorMembership

    operator = factory.SubFactory(OperatorFactory)
    user = factory.SubFactory(OperatorUserFactory)
    role = OperatorMemberRole.OWNER


class StopFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Stop

    name = factory.Sequence(lambda n: f"Stop {n}")
    city = factory.Sequence(lambda n: f"City {n}")
    latitude = Decimal("7.000000")
    longitude = Decimal("80.000000")


class RouteFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Route

    name = factory.Sequence(lambda n: f"Route {n}")
    origin = factory.SubFactory(StopFactory)
    destination = factory.SubFactory(StopFactory)


class BusFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Bus

    operator = factory.SubFactory(OperatorFactory)
    registration_number = factory.Sequence(lambda n: f"NB-{n:04d}")
    name = factory.Sequence(lambda n: f"Express {n}")
    seat_capacity = 45


_layout_numbers = itertools.count(1)


def create_seat_layout(layout_type: str = "2x2", passenger_rows: int = 10, **fields) -> SeatLayout:
    """A saved layout built from the standard template (2x2 x 10 rows = 41 seats)."""
    spec = generate_layout(layout_type, passenger_rows)
    fields.setdefault("name", f"Layout {next(_layout_numbers)}")
    layout = SeatLayout.objects.create(
        layout_type=layout_type, rows=spec["rows"], columns=spec["columns"], **fields
    )
    Seat.objects.bulk_create(Seat(layout=layout, **seat) for seat in spec["seats"])
    return layout


def create_route_with_stops(name: str, plan: tuple[tuple[str, int, int], ...], **fields) -> Route:
    """A route through `plan` = ((stop name, arrival minutes, departure minutes), ...)."""
    stops = [
        Stop.objects.get_or_create(
            name=stop_name,
            city=stop_name,
            defaults={"latitude": Decimal("7.000000"), "longitude": Decimal("80.000000")},
        )[0]
        for stop_name, _, _ in plan
    ]
    route = Route.objects.create(name=name, origin=stops[0], destination=stops[-1], **fields)
    RouteStop.objects.bulk_create(
        RouteStop(
            route=route,
            stop=stop,
            sequence=sequence,
            arrival_offset=timedelta(minutes=arrival),
            departure_offset=timedelta(minutes=departure),
            is_boarding_point=sequence < len(plan),
            is_dropoff_point=sequence > 1,
        )
        for sequence, (stop, (_, arrival, departure)) in enumerate(zip(stops, plan, strict=True), 1)
    )
    return route


def create_bookable_bus(**fields) -> Bus:
    """An active bus with a 41-seat layout, run by an active operator."""
    fields.setdefault("seat_layout", create_seat_layout())
    fields.setdefault("seat_capacity", 41)
    return BusFactory(**fields)


class TripFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Trip

    route = factory.SubFactory(RouteFactory)
    bus = factory.SubFactory(BusFactory)
    operator = factory.LazyAttribute(lambda trip: trip.bus.operator)
    departure_datetime = factory.LazyFunction(lambda: timezone.now() + timedelta(days=1))
    estimated_arrival_datetime = factory.LazyAttribute(
        lambda trip: trip.departure_datetime + timedelta(hours=3)
    )
    base_price = Decimal("1000.00")


class BookingFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Booking

    customer = factory.SubFactory(CustomerFactory)
    trip = factory.SubFactory(TripFactory)
    total_amount = Decimal("1000.00")
