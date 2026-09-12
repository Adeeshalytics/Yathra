from django.contrib import admin

from apps.payments.models import Payment

from .models import Booking, Passenger, SeatLock


class PassengerInline(admin.TabularInline):
    model = Passenger
    extra = 0
    fields = ["seat_number", "name", "phone", "email", "holds_seat"]
    readonly_fields = ["holds_seat"]


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    can_delete = False
    fields = ["transaction_reference", "amount", "status", "payment_method", "paid_at"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = [
        "booking_reference",
        "customer",
        "trip",
        "status",
        "total_amount",
        "expires_at",
        "created_at",
    ]
    list_filter = ["status"]
    search_fields = ["booking_reference", "customer__email", "passengers__name"]
    autocomplete_fields = ["customer", "trip", "boarding_stop", "dropoff_stop"]
    list_select_related = ["customer", "trip__route"]
    readonly_fields = [
        "id",
        "booking_reference",
        "unit_price",
        "subtotal",
        "service_fee",
        "discount",
        "tax",
        "total_amount",
        "expires_at",
        "confirmed_at",
        "cancelled_at",
        "created_at",
        "updated_at",
    ]
    date_hierarchy = "created_at"
    inlines = [PassengerInline, PaymentInline]


@admin.register(SeatLock)
class SeatLockAdmin(admin.ModelAdmin):
    list_display = ["trip", "seat_number", "customer", "expires_at"]
    list_select_related = ["trip", "customer"]
    search_fields = ["trip__code", "customer__email", "seat_number"]
    readonly_fields = ["id", "created_at", "updated_at"]
