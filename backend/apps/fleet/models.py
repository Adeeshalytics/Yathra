from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel
from apps.operators.models import Operator

from .validators import normalize_registration_number, validate_registration_number

MAX_SEAT_CAPACITY = 90
MAX_LAYOUT_ROWS = 25
MIN_LAYOUT_COLUMNS = 2
MAX_LAYOUT_COLUMNS = 7


class BusType(models.TextChoices):
    NORMAL = "normal", "Normal"
    AC = "ac", "AC"
    LUXURY = "luxury", "Luxury"
    SUPER_LUXURY = "super_luxury", "Super Luxury"


# Bus classes that are air-conditioned by definition.
AIR_CONDITIONED_BUS_TYPES = frozenset({BusType.AC, BusType.LUXURY, BusType.SUPER_LUXURY})


class BusFacility(models.TextChoices):
    AC = "ac", "AC"
    WIFI = "wifi", "WiFi"
    USB_CHARGING = "usb_charging", "USB charging"
    RECLINING_SEATS = "reclining_seats", "Reclining seats"
    TV = "tv", "TV"
    TOILET = "toilet", "Toilet"


class SeatLayoutType(models.TextChoices):
    TWO_BY_TWO = "2x2", "2 + 2"
    TWO_BY_ONE = "2x1", "2 + 1"
    CUSTOM = "custom", "Custom"


class SeatType(models.TextChoices):
    NORMAL = "normal", "Normal"
    WINDOW = "window", "Window"
    AISLE = "aisle", "Aisle"
    DRIVER = "driver", "Driver"
    CONDUCTOR = "conductor", "Conductor"
    RESERVED = "reserved", "Reserved"


PASSENGER_SEAT_TYPES = ("normal", "window", "aisle", "reserved")
# Reserved seats (clergy, passengers with disabilities, ...) exist but are not sold online.
BOOKABLE_SEAT_TYPES = ("normal", "window", "aisle")
CREW_SEAT_TYPES = ("driver", "conductor")


class SeatLayout(BaseModel):
    """
    A reusable seat map: a grid of `rows` x `columns` cells, some of which hold a seat.
    Buses point at a layout, so one "2 + 2, 45 seats" design serves a whole fleet, and the
    customer booking screen renders the same grid.
    """

    name = models.CharField(max_length=100, unique=True)
    layout_type = models.CharField(
        max_length=8, choices=SeatLayoutType.choices, default=SeatLayoutType.TWO_BY_TWO
    )
    rows = models.PositiveSmallIntegerField()
    columns = models.PositiveSmallIntegerField()
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(
                condition=Q(rows__gte=1, rows__lte=MAX_LAYOUT_ROWS), name="fleet_layout_rows_range"
            ),
            models.CheckConstraint(
                condition=Q(columns__gte=MIN_LAYOUT_COLUMNS, columns__lte=MAX_LAYOUT_COLUMNS),
                name="fleet_layout_columns_range",
            ),
            models.CheckConstraint(
                condition=Q(layout_type__in=SeatLayoutType.values), name="fleet_layout_type_valid"
            ),
        ]

    def __str__(self) -> str:
        return self.name

    def bookable_seat_count(self) -> int:
        return self.seats.filter(seat_type__in=BOOKABLE_SEAT_TYPES, is_available=True).count()


class Seat(BaseModel):
    layout = models.ForeignKey(SeatLayout, on_delete=models.CASCADE, related_name="seats")
    seat_number = models.CharField(max_length=8)
    row = models.PositiveSmallIntegerField()
    column = models.PositiveSmallIntegerField()
    seat_type = models.CharField(max_length=12, choices=SeatType.choices, default=SeatType.NORMAL)
    is_available = models.BooleanField(
        default=True, help_text="Unavailable seats (broken, blocked off) are never sold."
    )

    class Meta:
        ordering = ["row", "column"]
        constraints = [
            models.UniqueConstraint(
                fields=["layout", "seat_number"], name="fleet_seat_number_unique"
            ),
            models.UniqueConstraint(
                fields=["layout", "row", "column"], name="fleet_seat_position_unique"
            ),
            models.CheckConstraint(
                condition=Q(row__gte=1, column__gte=1), name="fleet_seat_position_positive"
            ),
            models.CheckConstraint(
                condition=Q(seat_type__in=SeatType.values), name="fleet_seat_type_valid"
            ),
            models.CheckConstraint(
                condition=~Q(seat_type__in=CREW_SEAT_TYPES) | Q(is_available=False),
                name="fleet_seat_crew_not_bookable",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.layout} · seat {self.seat_number}"

    @property
    def is_bookable(self) -> bool:
        return self.is_available and self.seat_type in BOOKABLE_SEAT_TYPES


class Bus(BaseModel):
    operator = models.ForeignKey(Operator, on_delete=models.PROTECT, related_name="buses")
    registration_number = models.CharField(
        max_length=20,
        unique=True,
        validators=[validate_registration_number],
        help_text="Vehicle registration, e.g. NB-1234 or WP NB-1234.",
    )
    name = models.CharField(max_length=100, help_text="Display label, e.g. 'Kandy Express'.")
    bus_type = models.CharField(max_length=16, choices=BusType.choices, default=BusType.NORMAL)
    seat_capacity = models.PositiveSmallIntegerField(help_text="Seats sold per trip.")
    seat_layout = models.ForeignKey(
        SeatLayout, on_delete=models.PROTECT, null=True, blank=True, related_name="buses"
    )
    facilities = ArrayField(
        models.CharField(max_length=20, choices=BusFacility.choices), default=list, blank=True
    )
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "buses"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["operator", "active"], name="fleet_bus_operator_active_idx"),
            GinIndex(fields=["facilities"], name="fleet_bus_facilities_gin"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(seat_capacity__gte=1, seat_capacity__lte=MAX_SEAT_CAPACITY),
                name="fleet_bus_seat_capacity_range",
            ),
            models.CheckConstraint(
                condition=Q(bus_type__in=BusType.values), name="fleet_bus_type_valid"
            ),
            models.CheckConstraint(
                condition=Q(facilities__contained_by=BusFacility.values),
                name="fleet_bus_facilities_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.registration_number})"

    def save(self, *args, **kwargs):
        try:
            self.registration_number = normalize_registration_number(self.registration_number)
        except ValidationError:
            self.registration_number = " ".join(self.registration_number.upper().split())
        super().save(*args, **kwargs)
