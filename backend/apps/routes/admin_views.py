from django.db.models import Count, Max, Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.admin_viewsets import ActivationActionsMixin, AdminModelViewSet

from .admin_serializers import AdminRouteListSerializer, AdminRouteSerializer, AdminStopSerializer
from .filters import RouteFilter
from .models import Route, RouteStop, Stop
from .services import clear_paths_through_stop


class AdminStopViewSet(ActivationActionsMixin, AdminModelViewSet):
    serializer_class = AdminStopSerializer
    filterset_fields = ["city", "active"]
    search_fields = ["name", "city"]
    ordering_fields = ["name", "city", "created_at"]
    ordering = ["city", "name"]

    def get_queryset(self):
        return Stop.objects.annotate(route_count=Count("route_stops__route", distinct=True))

    def perform_update(self, serializer):
        """Moving a stop moves every road route through it, so those stored paths are dropped."""
        was_at = (serializer.instance.latitude, serializer.instance.longitude)
        super().perform_update(serializer)
        stop = serializer.instance
        if (stop.latitude, stop.longitude) != was_at:
            clear_paths_through_stop(stop)

    def get_delete_blocker(self, stop: Stop) -> str | None:
        routes = Route.objects.filter(
            Q(route_stops__stop=stop) | Q(origin=stop) | Q(destination=stop)
        ).distinct()
        count = routes.count()
        if count:
            names = ", ".join(routes.order_by("name").values_list("name", flat=True)[:3])
            more = "…" if count > 3 else ""
            return (
                f"{stop.name} is used by {count} route(s) ({names}{more}). Remove it from those "
                "routes first, or deactivate it instead."
            )
        trips = stop.trip_stops.values("trip").distinct().count()
        if trips:
            return (
                f"{stop.name} is on the timetable of {trips} trip(s), so it has to stay on record. "
                "Deactivate it instead."
            )
        return None

    @extend_schema(responses=serializers.ListSerializer(child=serializers.CharField()))
    @action(detail=False, methods=["get"], pagination_class=None)
    def cities(self, request, *args, **kwargs):
        """Every city that has at least one stop (for filters and autocompletion)."""
        return Response(sorted(set(Stop.objects.values_list("city", flat=True))))


class AdminRouteViewSet(ActivationActionsMixin, AdminModelViewSet):
    filterset_class = RouteFilter
    search_fields = [
        "name",
        "route_number",
        "origin__name",
        "origin__city",
        "destination__name",
        "destination__city",
    ]
    ordering_fields = ["name", "route_number", "created_at"]
    ordering = ["name"]

    def get_queryset(self):
        queryset = Route.objects.select_related("origin", "destination").annotate(
            stop_count=Count("route_stops", distinct=True),
            journey_duration=Max("route_stops__arrival_offset"),
            trip_count=Count("trips", distinct=True),
        )
        if self.action != "list":
            queryset = queryset.prefetch_related(
                Prefetch(
                    "route_stops",
                    queryset=RouteStop.objects.select_related("stop").order_by("sequence"),
                )
            )
        return queryset

    def get_serializer_class(self):
        return AdminRouteListSerializer if self.action == "list" else AdminRouteSerializer

    def get_delete_blocker(self, route: Route) -> str | None:
        trips = route.trips.count()
        schedules = route.schedules.count()
        if trips or schedules:
            return (
                f"“{route.name}” has {trips} trip(s) and {schedules} schedule(s) on record. "
                "Deactivate the route instead of deleting it."
            )
        return None
