from datetime import timedelta

from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower

from apps.core.models import BaseModel


class Stop(BaseModel):
    """A physical place a bus stops at (bus stand, junction, terminal)."""

    name = models.CharField(max_length=120)
    city = models.CharField(max_length=80)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["city", "name"]
        indexes = [
            models.Index(fields=["city"], name="routes_stop_city_idx"),
            models.Index(fields=["name"], name="routes_stop_name_idx"),
        ]
        constraints = [
            # Case-insensitive: "Kandy, Kandy" and "kandy, KANDY" are the same place.
            models.UniqueConstraint(
                Lower("name"), Lower("city"), name="routes_stop_name_city_ci_unique"
            ),
            models.CheckConstraint(
                condition=Q(latitude__isnull=True, longitude__isnull=True)
                | Q(
                    latitude__gte=-90,
                    latitude__lte=90,
                    longitude__gte=-180,
                    longitude__lte=180,
                ),
                name="routes_stop_coordinates_valid",
            ),
        ]

    def __str__(self) -> str:
        return self.name if self.name == self.city else f"{self.name}, {self.city}"


class Route(BaseModel):
    """
    An ordered path between two stops. Routes are shared by the whole platform; operators
    run trips on them with their own buses. Origin and destination always mirror the first
    and last RouteStop.
    """

    name = models.CharField(max_length=150)
    route_number = models.CharField(
        max_length=16, blank=True, help_text="Official route number, e.g. 01 or 87."
    )
    origin = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="routes_starting_here")
    destination = models.ForeignKey(
        Stop, on_delete=models.PROTECT, related_name="routes_ending_here"
    )
    description = models.TextField(blank=True)
    base_fare = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Standard full-journey fare in LKR; individual trips may override it.",
    )
    active = models.BooleanField(default=True)
    stops = models.ManyToManyField(Stop, through="RouteStop", related_name="routes")

    # The road the bus actually drives, worked out once by the routing service and kept here so
    # that drawing a map costs nothing. Cleared whenever the stops (or their coordinates) change,
    # because a path that no longer matches the stops would be worse than no path at all.
    path = models.TextField(
        blank=True,
        help_text="The road route as an encoded polyline (precision 5), origin to destination.",
    )
    path_distance_m = models.PositiveIntegerField(null=True, blank=True)
    path_duration_s = models.PositiveIntegerField(null=True, blank=True)
    path_source = models.CharField(max_length=32, blank=True)
    path_updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(
                fields=["origin", "destination", "active"], name="routes_route_endpoints_idx"
            ),
            models.Index(fields=["route_number"], name="routes_route_number_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~Q(origin=F("destination")), name="routes_route_distinct_endpoints"
            ),
            models.CheckConstraint(
                condition=Q(base_fare__isnull=True) | Q(base_fare__gte=0),
                name="routes_route_fare_non_negative",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.route_number} {self.name}".strip()


class RouteStop(BaseModel):
    """
    A stop on a route. Offsets are measured from the trip's departure time, so a single
    route timetable serves every trip that runs on it.
    """

    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="route_stops")
    stop = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="route_stops")
    sequence = models.PositiveSmallIntegerField(help_text="1-based position along the route.")
    arrival_offset = models.DurationField(default=timedelta(0))
    departure_offset = models.DurationField(default=timedelta(0))
    is_boarding_point = models.BooleanField(default=True)
    is_dropoff_point = models.BooleanField(default=True)

    class Meta:
        ordering = ["route", "sequence"]
        constraints = [
            # Deferred so stops can be re-ordered (sequences swapped) inside one transaction.
            models.UniqueConstraint(
                fields=["route", "sequence"],
                name="routes_routestop_sequence_unique",
                deferrable=models.Deferrable.DEFERRED,
            ),
            models.UniqueConstraint(fields=["route", "stop"], name="routes_routestop_stop_unique"),
            models.CheckConstraint(
                condition=Q(sequence__gte=1), name="routes_routestop_sequence_positive"
            ),
            models.CheckConstraint(
                condition=Q(arrival_offset__gte=timedelta(0)),
                name="routes_routestop_arrival_non_negative",
            ),
            models.CheckConstraint(
                condition=Q(departure_offset__gte=F("arrival_offset")),
                name="routes_routestop_departs_after_arrival",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.route} #{self.sequence}: {self.stop}"
