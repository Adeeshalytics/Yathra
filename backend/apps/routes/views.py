from django.db.models import Prefetch
from rest_framework.permissions import AllowAny
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.core.caching import PublicCacheMixin

from .models import RouteStop, Stop
from .selectors import routes_with_summary
from .serializers import RouteDetailSerializer, RouteSerializer, StopSerializer


class StopViewSet(PublicCacheMixin, ReadOnlyModelViewSet):
    """Public list of active stops — feeds the "From" / "To" pickers."""

    permission_classes = [AllowAny]
    serializer_class = StopSerializer
    queryset = Stop.objects.filter(active=True)
    filterset_fields = ["city"]
    search_fields = ["name", "city"]
    ordering_fields = ["name", "city"]
    ordering = ["city", "name"]


class RouteViewSet(PublicCacheMixin, ReadOnlyModelViewSet):
    """Public list of active routes with duration and the lowest upcoming fare."""

    permission_classes = [AllowAny]
    filterset_fields = ["origin", "destination", "route_number"]
    search_fields = [
        "name",
        "route_number",
        "origin__name",
        "origin__city",
        "destination__name",
        "destination__city",
    ]
    ordering_fields = ["name", "route_number"]
    ordering = ["name"]

    def get_queryset(self):
        queryset = routes_with_summary()
        if self.action == "retrieve":
            queryset = queryset.prefetch_related(
                Prefetch(
                    "route_stops",
                    queryset=RouteStop.objects.select_related("stop").order_by("sequence"),
                )
            )
        return queryset

    def get_serializer_class(self):
        return RouteDetailSerializer if self.action == "retrieve" else RouteSerializer
