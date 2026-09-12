from django.db.models import Count, Max, Min, OuterRef, QuerySet, Subquery
from django.db.models.functions import Now

from apps.trips.models import Trip, TripStatus

from .models import Route


def routes_with_summary() -> QuerySet[Route]:
    """Active routes annotated with journey duration, stop count and the lowest upcoming fare."""
    upcoming_fare = (
        Trip.objects.filter(
            route=OuterRef("pk"),
            status=TripStatus.SCHEDULED,
            active=True,
            departure_datetime__gt=Now(),
        )
        .order_by()
        .values("route")
        .annotate(lowest=Min("base_price"))
        .values("lowest")
    )
    return (
        Route.objects.filter(active=True)
        .select_related("origin", "destination")
        .annotate(
            journey_duration=Max("route_stops__arrival_offset"),
            stop_count=Count("route_stops"),
            starting_fare=Subquery(upcoming_fare),
        )
    )
