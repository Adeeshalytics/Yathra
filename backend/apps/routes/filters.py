import django_filters

from .models import Route


class RouteFilter(django_filters.FilterSet):
    stop = django_filters.UUIDFilter(
        field_name="route_stops__stop", distinct=True, label="Passes through stop"
    )

    class Meta:
        model = Route
        fields = ["active", "origin", "destination"]
