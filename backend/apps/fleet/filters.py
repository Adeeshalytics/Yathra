import django_filters

from .models import Bus, BusFacility


class BusFilter(django_filters.FilterSet):
    facility = django_filters.ChoiceFilter(
        choices=BusFacility.choices, method="filter_facility", label="Has facility"
    )

    class Meta:
        model = Bus
        fields = ["operator", "bus_type", "active", "seat_layout"]

    def filter_facility(self, queryset, name, value):
        return queryset.filter(facilities__contains=[value])
