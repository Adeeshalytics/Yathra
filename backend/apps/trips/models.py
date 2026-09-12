from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import (
    ArrayField,
    DateTimeRangeField,
    RangeBoundary,
    RangeOperators,
)
from django.db import IntegrityError, models, transaction
from django.db.models import F, Func, Q
from django.utils import timezone

from apps.core.db import violated_constraint
from apps.core.models import BaseModel
from apps.fleet.models import Bus
from apps.operators.models import Operator
from apps.routes.models import Route, Stop

from .references import generate_trip_code

CODE_CONSTRAINT = "trips_trip_code_unique"
MAX_CODE_ATTEMPTS = 5
WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class TsTzRange(Func):
    """Postgres ``tstzrange(start, end, bounds)`` — used by the bus-overlap constraint."""

    function = "TSTZRANGE"
    output_field = DateTimeRangeField()


class TripStatus(models.TextChoices):
    SCHEDULED = "scheduled", "Scheduled"
    BOARDING = "boarding", "Boarding"
    DEPARTED = "departed", "Departed"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


# Trips that haven't left yet.
OPEN_TRIP_STATUSES = ("scheduled", "boarding")

# Allowed manual status changes. Cancelling has its own action (it is always allowed
# before completion and can't be undone).
STATUS_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "scheduled": ("boarding", "departed"),
    "boarding": ("scheduled", "departed"),
    "departed": ("completed",),
    "completed": (),
    "cancelled": (),
}


class Recurrence(models.TextChoices):
    DAILY = "daily", "Daily"
    WEEKLY = "weekly", "Selected weekdays"


class TripSchedule(BaseModel):
    """
    A recurring timetable entry, e.g. "WP NC-4521 leaves Colombo for Batticaloa at 20:30
    every day". Individual trips are generated from it on demand; editing a schedule
    never rewrites trips that already exist.
    """

    route = models.ForeignKey(Route, on_delete=models.PROTECT, related_name="schedules")
    bus = models.ForeignKey(Bus, on_delete=models.PROTECT, related_name="schedules")
    operator = models.ForeignKey(Operator, on_delete=models.PROTECT, related_name="trip_schedules")
    departure_time = models.TimeField(help_text="Sri Lanka time the bus leaves the origin.")
    base_price = models.DecimalField(
        max_digits=10, decimal_places=2, help_text="Ticket price per seat (LKR)."
    )
    recurrence = models.CharField(
        max_length=8, choices=Recurrence.choices, default=Recurrence.DAILY
    )
    weekdays = ArrayField(
        models.PositiveSmallIntegerField(),
        default=list,
        blank=True,
        help_text="0 = Monday … 6 = Sunday (for selected-weekday schedules).",
    )
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)
    last_generated_until = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["route__name", "departure_time"]
        indexes = [
            models.Index(fields=["bus", "active"], name="trips_sched_bus_active_idx"),
            models.Index(fields=["route", "active"], name="trips_sched_route_active_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(base_price__gte=0), name="trips_schedule_price_non_negative"
            ),
            models.CheckConstraint(
                condition=Q(recurrence__in=Recurrence.values),
                name="trips_schedule_recurrence_valid",
            ),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="trips_schedule_dates_ordered",
            ),
            models.CheckConstraint(
                condition=Q(weekdays__contained_by=[0, 1, 2, 3, 4, 5, 6]),
                name="trips_schedule_weekdays_valid",
            ),
            models.CheckConstraint(
                condition=~Q(recurrence="weekly") | Q(weekdays__len__gt=0),
                name="trips_schedule_weekly_has_days",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.route.name} · {self.departure_time:%H:%M} · {self.runs_label}"

    @property
    def runs_label(self) -> str:
        if self.recurrence == Recurrence.DAILY:
            return "daily"
        return ", ".join(WEEKDAY_NAMES[day] for day in sorted(self.weekdays))

    def runs_on(self, day) -> bool:
        return self.recurrence == Recurrence.DAILY or day.weekday() in self.weekdays


class Trip(BaseModel):
    """
    An actual scheduled journey: one bus on one route at one departure time. The operator is
    stored (not just implied by the bus) so history stays correct if a bus changes hands, and
    so operator-scoped queries don't need a join.
    """

    code = models.CharField(max_length=12, editable=False)
    route = models.ForeignKey(Route, on_delete=models.PROTECT, related_name="trips")
    bus = models.ForeignKey(Bus, on_delete=models.PROTECT, related_name="trips")
    operator = models.ForeignKey(Operator, on_delete=models.PROTECT, related_name="trips")
    schedule = models.ForeignKey(
        TripSchedule, on_delete=models.SET_NULL, null=True, blank=True, related_name="trips"
    )
    departure_datetime = models.DateTimeField()
    estimated_arrival_datetime = models.DateTimeField()
    status = models.CharField(
        max_length=16, choices=TripStatus.choices, default=TripStatus.SCHEDULED
    )
    base_price = models.DecimalField(
        max_digits=10, decimal_places=2, help_text="Fare per seat (LKR)."
    )
    active = models.BooleanField(default=True, help_text="Inactive trips are hidden from sale.")
    cancellation_reason = models.TextField(blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["departure_datetime"]
        indexes = [
            models.Index(
                fields=["route", "departure_datetime"], name="trips_trip_route_departure_idx"
            ),
            models.Index(
                fields=["status", "departure_datetime"], name="trips_trip_status_depart_idx"
            ),
            models.Index(fields=["bus", "departure_datetime"], name="trips_trip_bus_departure_idx"),
            models.Index(
                fields=["operator", "departure_datetime"], name="trips_trip_operator_depart_idx"
            ),
        ]
        constraints = [
            models.UniqueConstraint(fields=["code"], name=CODE_CONSTRAINT),
            models.CheckConstraint(
                condition=Q(base_price__gte=0), name="trips_trip_price_non_negative"
            ),
            models.CheckConstraint(
                condition=Q(status__in=TripStatus.values), name="trips_trip_status_valid"
            ),
            models.CheckConstraint(
                condition=Q(estimated_arrival_datetime__gt=F("departure_datetime")),
                name="trips_trip_arrives_after_departure",
            ),
            # A bus can't be on two journeys at once. Enforced by Postgres itself, so it
            # holds for every code path (API, admin, scripts). Cancelled trips don't count.
            ExclusionConstraint(
                name="trips_trip_no_bus_overlap",
                expressions=[
                    (
                        TsTzRange(
                            "departure_datetime", "estimated_arrival_datetime", RangeBoundary()
                        ),
                        RangeOperators.OVERLAPS,
                    ),
                    ("bus", RangeOperators.EQUAL),
                ],
                condition=~Q(status="cancelled"),
            ),
        ]

    def __str__(self) -> str:
        departure = timezone.localtime(self.departure_datetime)
        return f"{self.code} · {self.route.name} · {departure:%d %b %Y %H:%M}"

    @property
    def is_editable(self) -> bool:
        return self.status == TripStatus.SCHEDULED

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)
        for attempt in range(1, MAX_CODE_ATTEMPTS + 1):
            self.code = generate_trip_code()
            try:
                with transaction.atomic():  # savepoint: a clash mustn't break the caller's tx
                    return super().save(*args, **kwargs)
            except IntegrityError as exc:
                self.code = ""
                if violated_constraint(exc) != CODE_CONSTRAINT or attempt == MAX_CODE_ATTEMPTS:
                    raise
        return None


class TripStop(BaseModel):
    """
    The trip's own timetable: when this bus reaches each stop. Copied from the route's
    offsets when the trip is created and adjustable per trip, so later edits to the route
    never move journeys that are already on sale.
    """

    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="trip_stops")
    stop = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="trip_stops")
    sequence = models.PositiveSmallIntegerField()
    arrival_datetime = models.DateTimeField()
    departure_datetime = models.DateTimeField()
    is_boarding_point = models.BooleanField(default=True)
    is_dropoff_point = models.BooleanField(default=True)

    class Meta:
        ordering = ["trip", "sequence"]
        indexes = [
            models.Index(fields=["stop", "departure_datetime"], name="trips_tripstop_stop_dep_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["trip", "sequence"], name="trips_tripstop_sequence_unique"
            ),
            models.UniqueConstraint(fields=["trip", "stop"], name="trips_tripstop_stop_unique"),
            models.CheckConstraint(
                condition=Q(departure_datetime__gte=F("arrival_datetime")),
                name="trips_tripstop_departs_after_arrival",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.trip.code} #{self.sequence}: {self.stop}"
