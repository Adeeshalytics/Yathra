"""
Populate a development database with realistic Sri Lankan sample data.

Idempotent: safe to run repeatedly. Refuses to run with DEBUG off unless --force is given.

    python manage.py seed_dev_data
    python manage.py seed_dev_data --password "S0mething-Strong!"
"""

import random
from datetime import time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User, UserRole
from apps.bookings.models import Booking, BookingStatus, Passenger
from apps.bookings.pricing import quote
from apps.core.validators import normalize_phone_number
from apps.fleet.models import Bus, BusFacility, BusType, Seat, SeatLayout, SeatType
from apps.fleet.seat_layouts import generate_layout
from apps.operators.models import Operator, OperatorMemberRole, OperatorMembership, OperatorStatus
from apps.payments.models import Payment, PaymentMethod, PaymentStatus, Refund, RefundStatus
from apps.payments.providers import MANUAL_PROVIDER
from apps.routes.models import Route, RouteStop, Stop
from apps.tickets.services import issue_ticket
from apps.trips.models import Recurrence, Trip, TripSchedule, TripStatus
from apps.trips.selectors import sellable_seats
from apps.trips.services import generate_trips

STOPS = [
    # name, city, latitude, longitude
    ("Colombo Fort", "Colombo", "6.933600", "79.850000"),
    ("Makumbura Multimodal Centre", "Kottawa", "6.840700", "79.978600"),
    ("Kadawatha", "Kadawatha", "7.001600", "79.953000"),
    ("Kegalle", "Kegalle", "7.251300", "80.346400"),
    ("Kandy", "Kandy", "7.291900", "80.630500"),
    ("Galle", "Galle", "6.032900", "80.216800"),
    ("Matara", "Matara", "5.954900", "80.555000"),
    ("Kurunegala", "Kurunegala", "7.486300", "80.364700"),
    ("Dambulla", "Dambulla", "7.874200", "80.651100"),
    ("Habarana", "Habarana", "8.038600", "80.749700"),
    ("Trincomalee", "Trincomalee", "8.587400", "81.215200"),
    ("Batticaloa", "Batticaloa", "7.731000", "81.674700"),
    ("Anuradhapura", "Anuradhapura", "8.311400", "80.403700"),
    ("Vavuniya", "Vavuniya", "8.751400", "80.497100"),
    ("Jaffna", "Jaffna", "9.661500", "80.025500"),
    ("Nuwara Eliya", "Nuwara Eliya", "6.949700", "80.789100"),
    ("Badulla", "Badulla", "6.993400", "81.055000"),
]

OPERATORS = [
    # company, registration number, phone, email, address, status
    (
        "Lanka Express Lines (Pvt) Ltd",
        "PV-00012345",
        "0112345678",
        "ops@lankaexpress.example",
        "No. 45, Olcott Mawatha, Colombo 11",
        OperatorStatus.ACTIVE,
    ),
    (
        "Ceylon Coach Services",
        "PV-00067890",
        "0812223344",
        "hello@ceyloncoach.example",
        "No. 12, Peradeniya Road, Kandy",
        OperatorStatus.ACTIVE,
    ),
    (
        "Ruhuna Travels",
        "PV-00099881",
        "0412233445",
        "info@ruhunatravels.example",
        "No. 7, Beach Road, Matara",
        OperatorStatus.PENDING,
    ),
]

LAYOUTS = [
    # name, template, passenger rows, reserved seats, description
    ("2+2 Standard · 45 seats", "2x2", 11, (), "Common 2 + 2 intercity layout, full back row."),
    (
        "2+2 Comfort · 41 seats",
        "2x2",
        10,
        ("1", "2"),
        "Extra legroom; the two front seats are reserved for clergy.",
    ),
    ("2+1 Executive · 31 seats", "2x1", 10, (), "Wide 2 + 1 seating for super luxury services."),
    ("2+1 Compact · 25 seats", "2x1", 8, (), "Smaller 2 + 1 coach for hill-country roads."),
]

# name, route number, standard fare, stops [(stop name, minutes after departure)]
ROUTES = [
    ("Colombo – Kandy", "01", "790.00",
     [("Colombo Fort", 0), ("Kadawatha", 45), ("Kegalle", 120), ("Kandy", 210)]),
    ("Colombo – Galle (Expressway)", "", "1100.00",
     [("Makumbura Multimodal Centre", 0), ("Galle", 75)]),
    ("Colombo – Matara", "02", "880.00",
     [("Colombo Fort", 0), ("Galle", 180), ("Matara", 240)]),
    ("Colombo – Jaffna", "87", "2450.00",
     [("Colombo Fort", 0), ("Kurunegala", 150), ("Anuradhapura", 270), ("Vavuniya", 360),
      ("Jaffna", 510)]),
    ("Colombo – Trincomalee", "49", "1650.00",
     [("Colombo Fort", 0), ("Kurunegala", 150), ("Dambulla", 240), ("Habarana", 285),
      ("Trincomalee", 390)]),
    # Colombo 20:30 → Kadawatha 21:00 → Kurunegala 22:30 → Dambulla 00:30 → Batticaloa 05:30
    ("Colombo – Batticaloa", "", "1850.00",
     [("Colombo Fort", 0), ("Kadawatha", 30), ("Kurunegala", 120), ("Dambulla", 240),
      ("Habarana", 300), ("Batticaloa", 540)]),
    ("Kandy – Nuwara Eliya", "", "620.00",
     [("Kandy", 0), ("Nuwara Eliya", 165)]),
    ("Colombo – Badulla", "99", "1450.00",
     [("Colombo Fort", 0), ("Badulla", 420)]),
]  # fmt: skip

F = BusFacility
# registration, label, type, capacity, layout name, facilities, operator index
BUSES = [
    ("NB-4521", "Hill Country Express", BusType.LUXURY, 45, "2+2 Standard · 45 seats",
     [F.AC, F.USB_CHARGING, F.RECLINING_SEATS], 0),
    ("NC-7810", "Southern Star", BusType.SUPER_LUXURY, 31, "2+1 Executive · 31 seats",
     [F.AC, F.WIFI, F.USB_CHARGING, F.RECLINING_SEATS, F.TV], 0),
    ("ND-3302", "Ruhunu Comet", BusType.NORMAL, 45, "2+2 Standard · 45 seats", [], 1),
    ("NB-9012", "Northern Night Rider", BusType.SUPER_LUXURY, 31, "2+1 Executive · 31 seats",
     [F.AC, F.WIFI, F.USB_CHARGING, F.RECLINING_SEATS, F.TV, F.TOILET], 0),
    ("NC-5566", "East Coast Liner", BusType.AC, 45, "2+2 Standard · 45 seats",
     [F.AC, F.USB_CHARGING], 1),
    ("NC-8120", "Eastern Breeze", BusType.AC, 45, "2+2 Standard · 45 seats", [F.AC], 1),
    ("WP NC-4521", "Batticaloa Night Express", BusType.SUPER_LUXURY, 31,
     "2+1 Executive · 31 seats", [F.AC, F.WIFI, F.USB_CHARGING, F.RECLINING_SEATS, F.TOILET], 1),
    ("CP-2211", "Misty Hills Shuttle", BusType.NORMAL, 25, "2+1 Compact · 25 seats", [], 1),
    ("NB-7788", "Uva Express", BusType.LUXURY, 39, "2+2 Comfort · 41 seats",
     [F.AC, F.RECLINING_SEATS], 0),
]  # fmt: skip

WEEKEND = [5, 6]
# route, bus, departure, price (None = route fare), weekdays (None = daily)
SCHEDULES = [
    ("Colombo – Kandy", "NB-4521", time(6, 0), None, None),
    ("Colombo – Kandy", "NB-4521", time(14, 30), None, None),
    ("Colombo – Galle (Expressway)", "NC-7810", time(6, 0), None, None),
    ("Colombo – Galle (Expressway)", "NC-7810", time(14, 30), None, None),
    ("Colombo – Matara", "ND-3302", time(6, 0), None, None),
    ("Colombo – Matara", "ND-3302", time(14, 30), None, None),
    ("Colombo – Jaffna", "NB-9012", time(20, 0), None, None),
    ("Colombo – Trincomalee", "NC-5566", time(6, 0), None, None),
    ("Colombo – Trincomalee", "NC-5566", time(14, 30), None, None),
    ("Colombo – Batticaloa", "NC-8120", time(7, 0), None, None),
    ("Colombo – Batticaloa", "WP NC-4521", time(20, 30), "2500.00", None),
    ("Kandy – Nuwara Eliya", "CP-2211", time(6, 0), None, None),
    ("Kandy – Nuwara Eliya", "CP-2211", time(14, 30), None, WEEKEND),
    ("Colombo – Badulla", "NB-7788", time(6, 0), None, None),
    ("Colombo – Badulla", "NB-7788", time(14, 30), None, None),
]

DAYS_AHEAD = 14
DWELL = timedelta(minutes=5)

# Upcoming trips that get some seats sold, so the customer seat maps show booked seats.
DEMO_OCCUPANCY_ROUTES = ("Colombo – Batticaloa", "Colombo – Kandy", "Colombo – Jaffna")
DEMO_TRIPS_PER_ROUTE = 4
DEMO_NAMES = [
    "Nimali Perera", "Sahan Jayasuriya", "Fathima Rizwan", "Kavindu Silva",
    "Tharushi Fernando", "Ravi Kumar", "Ayesha Nazeer", "Dinuka Bandara",
    "Ishara Wickramasinghe", "Mohamed Irfan", "Sanduni Herath", "Pradeep Rajapaksha",
]  # fmt: skip


def journey_fields(trip: Trip, seats: int) -> dict:
    """Whole-route journey and the server-side price for a seeded booking."""
    stops = list(trip.trip_stops.order_by("sequence"))
    price = quote(trip, seats)
    return {
        "boarding_stop_id": stops[0].stop_id,
        "boarding_time": stops[0].departure_datetime,
        "dropoff_stop_id": stops[-1].stop_id,
        "dropoff_time": stops[-1].arrival_datetime,
        "unit_price": price.unit_price,
        "subtotal": price.subtotal,
        "service_fee": price.service_fee,
        "discount": price.discount,
        "tax": price.tax,
        "total_amount": price.total,
    }


class Command(BaseCommand):
    help = "Seed the database with development sample data (stops, routes, fleet, trips, users)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default="Yathra@Dev2026",
            help="Password for the seeded admin / operator / customer accounts.",
        )
        parser.add_argument("--force", action="store_true", help="Allow running with DEBUG=False.")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError("Refusing to seed sample data with DEBUG=False (use --force).")

        password = options["password"]
        stops = self._seed_stops()
        operators = self._seed_operators()
        layouts = self._seed_layouts()
        users = self._seed_users(password, operators[0])
        routes = self._seed_routes(stops)
        buses = self._seed_buses(operators, layouts)
        self._seed_schedules(routes, buses)
        self._seed_sample_booking(users["customer"], routes["Colombo – Kandy"])
        self._seed_booking_history(users["customer"], routes["Colombo – Kandy"])
        self._seed_demo_occupancy()

        self.stdout.write(self.style.SUCCESS("Development data ready."))
        self.stdout.write(
            f"  Stops: {Stop.objects.count()}  Routes: {Route.objects.count()}  "
            f"Buses: {Bus.objects.count()}  Seat layouts: {SeatLayout.objects.count()}  "
            f"Schedules: {TripSchedule.objects.count()}  Trips: {Trip.objects.count()}"
        )
        for role, user in users.items():
            self.stdout.write(f"  {role:<9} {user.email}  /  {password}")

    def _seed_stops(self) -> dict[str, Stop]:
        stops = {}
        for name, city, latitude, longitude in STOPS:
            stop, _ = Stop.objects.update_or_create(
                name=name,
                city=city,
                defaults={
                    "latitude": Decimal(latitude),
                    "longitude": Decimal(longitude),
                    "active": True,
                },
            )
            stops[name] = stop
        return stops

    def _seed_operators(self) -> list[Operator]:
        operators = []
        for company, registration, phone, email, address, status in OPERATORS:
            operator, _ = Operator.objects.update_or_create(
                registration_number=registration,
                defaults={
                    "company_name": company,
                    "contact_phone": normalize_phone_number(phone),
                    "contact_email": email,
                    "address": address,
                    "status": status,
                },
            )
            operators.append(operator)
        return operators

    def _seed_layouts(self) -> dict[str, SeatLayout]:
        layouts = {}
        for name, template, passenger_rows, reserved, description in LAYOUTS:
            spec = generate_layout(template, passenger_rows)
            layout, _ = SeatLayout.objects.update_or_create(
                name=name,
                defaults={
                    "layout_type": template,
                    "rows": spec["rows"],
                    "columns": spec["columns"],
                    "description": description,
                    "active": True,
                },
            )
            for seat in spec["seats"]:
                if seat["seat_number"] in reserved:
                    seat["seat_type"] = SeatType.RESERVED
            layout.seats.all().delete()
            Seat.objects.bulk_create(Seat(layout=layout, **seat) for seat in spec["seats"])
            layouts[name] = layout
        return layouts

    def _seed_users(self, password: str, operator: Operator) -> dict[str, User]:
        specs = {
            "admin": ("admin@yathra.test", "Platform Admin", "+94770000001", UserRole.ADMIN),
            "operator": ("operator@yathra.test", "Nimal Perera", "+94770000002", UserRole.OPERATOR),
            "customer": (
                "customer@yathra.test",
                "Kasuni Fernando",
                "+94770000003",
                UserRole.CUSTOMER,
            ),
        }
        users = {}
        for key, (email, name, phone, role) in specs.items():
            user = User.objects.filter(email=email).first() or User(email=email)
            user.name = name
            user.phone = phone
            user.role = role
            user.is_active = True
            user.is_staff = role == UserRole.ADMIN
            user.is_superuser = role == UserRole.ADMIN
            user.set_password(password)
            user.save()
            users[key] = user

        OperatorMembership.objects.update_or_create(
            operator=operator,
            user=users["operator"],
            defaults={"role": OperatorMemberRole.OWNER, "is_active": True},
        )
        return users

    def _seed_routes(self, stops: dict[str, Stop]) -> dict[str, Route]:
        routes = {}
        for name, number, fare, stop_plan in ROUTES:
            origin, destination = stops[stop_plan[0][0]], stops[stop_plan[-1][0]]
            route, _ = Route.objects.update_or_create(
                name=name,
                defaults={
                    "route_number": number,
                    "origin": origin,
                    "destination": destination,
                    "description": f"Daily service from {origin.city} to {destination.city}.",
                    "base_fare": Decimal(fare),
                    "active": True,
                },
            )
            # Existing trips keep their own stop timings, so the timetable can be rebuilt freely.
            route.route_stops.all().delete()
            last = len(stop_plan) - 1
            RouteStop.objects.bulk_create(
                RouteStop(
                    route=route,
                    stop=stops[stop_name],
                    sequence=index + 1,
                    arrival_offset=timedelta(minutes=minutes),
                    departure_offset=timedelta(minutes=minutes)
                    + (DWELL if 0 < index < last else timedelta(0)),
                    is_boarding_point=index < last,
                    is_dropoff_point=index > 0,
                )
                for index, (stop_name, minutes) in enumerate(stop_plan)
            )
            routes[name] = route
        return routes

    def _seed_buses(
        self, operators: list[Operator], layouts: dict[str, SeatLayout]
    ) -> dict[str, Bus]:
        buses = {}
        for registration, label, bus_type, capacity, layout, facilities, operator in BUSES:
            bus, _ = Bus.objects.update_or_create(
                registration_number=registration,
                defaults={
                    "operator": operators[operator],
                    "name": label,
                    "bus_type": bus_type,
                    "seat_capacity": capacity,
                    "seat_layout": layouts[layout],
                    "facilities": [facility.value for facility in facilities],
                    "active": True,
                },
            )
            buses[registration] = bus
        return buses

    def _seed_schedules(self, routes: dict[str, Route], buses: dict[str, Bus]) -> None:
        today = timezone.localdate()
        first_day, last_day = today + timedelta(days=1), today + timedelta(days=DAYS_AHEAD)
        for route_name, registration, departure, price, weekdays in SCHEDULES:
            route, bus = routes[route_name], buses[registration]
            values = {
                "route": route,
                "operator": bus.operator,
                "base_price": Decimal(price) if price else route.base_fare,
                "recurrence": Recurrence.WEEKLY if weekdays else Recurrence.DAILY,
                "weekdays": weekdays or [],
                "end_date": None,
                "active": True,
            }
            # A re-run keeps the schedule's original start date.
            schedule, _ = TripSchedule.objects.update_or_create(
                bus=bus,
                departure_time=departure,
                defaults=values,
                create_defaults={**values, "start_date": today},
            )
            # Trips seeded before schedules existed belong to this timetable too.
            legacy = Trip.objects.filter(
                bus=bus, route=route, schedule__isnull=True, departure_datetime__time=departure
            )
            Trip.objects.filter(
                pk__in=[
                    trip.pk
                    for trip in legacy
                    if schedule.runs_on(timezone.localdate(trip.departure_datetime))
                ]
            ).update(schedule=schedule)
            generate_trips(schedule, first_day, last_day)

    def _seed_demo_occupancy(self) -> None:
        """Seats already sold on the next few trips of busy routes, so seat maps look real."""
        walk_in, created = User.objects.get_or_create(
            email="walk-in@yathra.test",
            defaults={"name": "Counter sales", "phone": "+94770000009", "role": UserRole.CUSTOMER},
        )
        if created:
            walk_in.set_unusable_password()
            walk_in.save(update_fields=["password"])

        now = timezone.now()
        for route_name in DEMO_OCCUPANCY_ROUTES:
            trips = (
                Trip.objects.filter(
                    route__name=route_name,
                    status=TripStatus.SCHEDULED,
                    departure_datetime__gt=now,
                )
                .select_related("bus__seat_layout")
                .order_by("departure_datetime")[:DEMO_TRIPS_PER_ROUTE]
            )
            for trip in trips:
                if trip.bookings.exists():
                    continue
                # Demo data only; seeded per trip so re-runs pick the same seats.
                rng = random.Random(trip.code)  # noqa: S311
                seats = [seat.seat_number for seat in sellable_seats(trip)]
                taken = rng.sample(seats, k=min(len(seats), rng.randint(6, 16)))
                while taken:
                    size = rng.randint(1, 3)
                    group, taken = taken[:size], taken[size:]
                    booking = Booking.objects.create(
                        customer=walk_in,
                        trip=trip,
                        status=BookingStatus.CONFIRMED,
                        confirmed_at=now,
                        **journey_fields(trip, len(group)),
                    )
                    Passenger.objects.bulk_create(
                        Passenger(
                            booking=booking,
                            trip=trip,
                            name=rng.choice(DEMO_NAMES),
                            seat_number=seat,
                        )
                        for seat in group
                    )
                    Payment.objects.create(
                        booking=booking,
                        provider=MANUAL_PROVIDER,
                        amount=booking.total_amount,
                        status=PaymentStatus.SUCCESSFUL,
                        payment_method=PaymentMethod.CASH,
                        paid_at=now,
                    )
                    issue_ticket(booking, now)

    def _seed_sample_booking(self, customer: User, route: Route) -> None:
        if Booking.objects.filter(customer=customer).exists():
            return
        trip = (
            Trip.objects.filter(
                route=route, status=TripStatus.SCHEDULED, departure_datetime__gt=timezone.now()
            )
            .order_by("departure_datetime")
            .first()
        )
        if trip is None:
            return
        passengers = [("Kasuni Fernando", "12"), ("Dilan Fernando", "13")]
        booking = Booking.objects.create(
            customer=customer,
            trip=trip,
            status=BookingStatus.CONFIRMED,
            confirmed_at=timezone.now(),
            **journey_fields(trip, len(passengers)),
        )
        Passenger.objects.bulk_create(
            Passenger(
                booking=booking,
                trip=trip,
                name=name,
                phone=customer.phone,
                email=customer.email,
                seat_number=seat,
            )
            for name, seat in passengers
        )
        # A declined card first, then a successful retry: shows both in the admin payments list.
        now = timezone.now()
        Payment.objects.create(
            booking=booking,
            provider="mock",
            amount=booking.total_amount,
            status=PaymentStatus.FAILED,
            failure_reason="Your bank declined the payment (test).",
        )
        Payment.objects.create(
            booking=booking,
            provider="mock",
            provider_reference="MOCKSEED0001",
            amount=booking.total_amount,
            status=PaymentStatus.SUCCESSFUL,
            payment_method=PaymentMethod.CARD,
            paid_at=now,
        )
        issue_ticket(booking, now)

    def _seed_booking_history(self, customer: User, route: Route) -> None:
        """A trip already travelled and one cancelled, so every dashboard tab has something."""
        if Booking.objects.filter(
            customer=customer, status__in=(BookingStatus.COMPLETED, BookingStatus.CANCELLED)
        ).exists():
            return
        trips = list(
            Trip.objects.filter(
                route=route, status=TripStatus.SCHEDULED, departure_datetime__gt=timezone.now()
            ).order_by("departure_datetime")[1:3]
        )
        if len(trips) < 2:
            return
        travelled_trip, dropped_trip = trips
        now = timezone.now()

        travelled = Booking.objects.create(
            customer=customer,
            trip=travelled_trip,
            status=BookingStatus.COMPLETED,
            confirmed_at=now - timedelta(days=32),
            **journey_fields(travelled_trip, 1),
        )
        Passenger.objects.create(
            booking=travelled,
            trip=travelled_trip,
            name=customer.name,
            phone=customer.phone,
            email=customer.email,
            seat_number="21",
        )
        # The dashboard sorts history by the passenger's own boarding time.
        Booking.objects.filter(pk=travelled.pk).update(
            boarding_time=now - timedelta(days=30),
            dropoff_time=now - timedelta(days=30) + timedelta(hours=3),
        )
        Payment.objects.create(
            booking=travelled,
            provider="mock",
            provider_reference="MOCKSEED0002",
            amount=travelled.total_amount,
            status=PaymentStatus.SUCCESSFUL,
            payment_method=PaymentMethod.CARD,
            paid_at=now - timedelta(days=32),
        )
        issue_ticket(travelled, now - timedelta(days=32))

        dropped = Booking.objects.create(
            customer=customer,
            trip=dropped_trip,
            status=BookingStatus.CANCELLED,
            confirmed_at=now - timedelta(days=15),
            cancelled_at=now - timedelta(days=14),
            cancellation_reason="Plans changed",
            **journey_fields(dropped_trip, 1),
        )
        Passenger.objects.create(
            booking=dropped,
            trip=dropped_trip,
            name=customer.name,
            phone=customer.phone,
            email=customer.email,
            seat_number="22",
            holds_seat=False,
        )
        refunded_payment = Payment.objects.create(
            booking=dropped,
            provider="mock",
            provider_reference="MOCKSEED0003",
            amount=dropped.total_amount,
            status=PaymentStatus.SUCCESSFUL,
            payment_method=PaymentMethod.CARD,
            paid_at=now - timedelta(days=15),
            requires_refund=True,
        )
        # Cancelled well before departure, so the policy refunds it in full.
        Refund.objects.create(
            booking=dropped,
            payment=refunded_payment,
            amount=dropped.total_amount,
            currency=dropped.currency,
            status=RefundStatus.REQUESTED,
            reason="Plans changed",
            requested_by=customer,
            breakdown={
                "source": "cancellation_policy",
                "refund_percent": "100",
                "paid_amount": f"{dropped.total_amount:.2f}",
            },
        )
