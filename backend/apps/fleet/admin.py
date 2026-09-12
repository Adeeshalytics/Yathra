from django.contrib import admin

from .models import Bus, Seat, SeatLayout


@admin.register(Bus)
class BusAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "registration_number",
        "operator",
        "bus_type",
        "seat_capacity",
        "active",
    ]
    list_filter = ["bus_type", "active", "operator"]
    search_fields = ["name", "registration_number", "operator__company_name"]
    autocomplete_fields = ["operator", "seat_layout"]
    list_select_related = ["operator"]
    readonly_fields = ["id", "created_at", "updated_at"]


class SeatInline(admin.TabularInline):
    model = Seat
    extra = 0
    fields = ["seat_number", "row", "column", "seat_type", "is_available"]


@admin.register(SeatLayout)
class SeatLayoutAdmin(admin.ModelAdmin):
    list_display = ["name", "layout_type", "rows", "columns", "active"]
    list_filter = ["layout_type", "active"]
    search_fields = ["name"]
    readonly_fields = ["id", "created_at", "updated_at"]
    inlines = [SeatInline]
