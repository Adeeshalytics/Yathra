import django_filters
from django.utils import timezone

from .models import Trip


class TripFilter(django_filters.FilterSet):
    # Dates are Sri Lanka calendar days (`__date` uses the active time zone).
    date = django_filters.DateFilter(field_name="departure_datetime", lookup_expr="date")
    date_from = django_filters.DateFilter(field_name="departure_datetime", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="departure_datetime", lookup_expr="date__lte")
    upcoming = django_filters.BooleanFilter(method="filter_upcoming")

    class Meta:
        model = Trip
        fields = ["route", "bus", "operator", "status", "active", "schedule"]

    def filter_upcoming(self, queryset, name, value):
        now = timezone.now()
        return (
            queryset.filter(departure_datetime__gt=now)
            if value
            else queryset.filter(departure_datetime__lte=now)
        )
