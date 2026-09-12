from django.contrib import admin

from .models import Trip, TripSchedule, TripStop


class TripStopInline(admin.TabularInline):
    model = TripStop
    extra = 0
    ordering = ["sequence"]
    autocomplete_fields = ["stop"]
    fields = [
        "sequence",
        "stop",
        "arrival_datetime",
        "departure_datetime",
        "is_boarding_point",
        "is_dropoff_point",
    ]


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = [
        "code",
        "route",
        "bus",
        "operator",
        "departure_datetime",
        "status",
        "base_price",
        "active",
    ]
    list_filter = ["status", "active", "operator"]
    search_fields = ["code", "route__name", "bus__registration_number", "bus__name"]
    autocomplete_fields = ["route", "bus", "operator", "schedule"]
    list_select_related = ["route", "bus", "operator"]
    date_hierarchy = "departure_datetime"
    readonly_fields = ["id", "code", "created_at", "updated_at"]
    inlines = [TripStopInline]


@admin.register(TripSchedule)
class TripScheduleAdmin(admin.ModelAdmin):
    list_display = [
        "route",
        "bus",
        "departure_time",
        "recurrence",
        "start_date",
        "end_date",
        "active",
    ]
    list_filter = ["recurrence", "active", "operator"]
    search_fields = ["route__name", "bus__registration_number"]
    autocomplete_fields = ["route", "bus", "operator"]
    list_select_related = ["route", "bus"]
    readonly_fields = ["id", "last_generated_until", "created_at", "updated_at"]
