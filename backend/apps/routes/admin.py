from django.contrib import admin

from .models import Route, RouteStop, Stop


@admin.register(Stop)
class StopAdmin(admin.ModelAdmin):
    list_display = ["name", "city", "latitude", "longitude", "active"]
    list_filter = ["active", "city"]
    search_fields = ["name", "city"]
    readonly_fields = ["id", "created_at", "updated_at"]


class RouteStopInline(admin.TabularInline):
    model = RouteStop
    extra = 0
    ordering = ["sequence"]
    autocomplete_fields = ["stop"]
    fields = [
        "sequence",
        "stop",
        "arrival_offset",
        "departure_offset",
        "is_boarding_point",
        "is_dropoff_point",
    ]


@admin.register(Route)
class RouteAdmin(admin.ModelAdmin):
    list_display = ["name", "route_number", "origin", "destination", "active"]
    list_filter = ["active"]
    search_fields = ["name", "route_number", "origin__name", "destination__name"]
    autocomplete_fields = ["origin", "destination"]
    list_select_related = ["origin", "destination"]
    readonly_fields = ["id", "created_at", "updated_at"]
    inlines = [RouteStopInline]
