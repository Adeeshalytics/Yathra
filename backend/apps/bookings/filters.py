import django_filters
from django.db.models import QuerySet

from .models import Booking, BookingStatus
from .selectors import SCOPES, scoped

SCOPE_CHOICES = [
    ("upcoming", "Upcoming trips"),
    ("past", "Previous trips"),
    ("cancelled", "Cancelled bookings"),
]


class BookingFilter(django_filters.FilterSet):
    """The customer's booking history: the dashboard tabs, plus status and date narrowing."""

    status = django_filters.MultipleChoiceFilter(choices=BookingStatus.choices)
    scope = django_filters.ChoiceFilter(
        choices=SCOPE_CHOICES, method="by_scope", label="Upcoming, past or cancelled"
    )
    trip = django_filters.UUIDFilter(field_name="trip_id")
    date_from = django_filters.DateFilter(field_name="departure", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="departure", lookup_expr="date__lte")

    class Meta:
        model = Booking
        fields = ["status", "scope", "trip", "date_from", "date_to"]

    def by_scope(self, queryset: QuerySet, name: str, value: str) -> QuerySet:
        return scoped(queryset, value) if value in SCOPES else queryset
