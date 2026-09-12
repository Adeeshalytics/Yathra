from django.contrib import admin

from .models import Payment, PaymentEvent, Refund


class PaymentEventInline(admin.TabularInline):
    model = PaymentEvent
    extra = 0
    can_delete = False
    fields = ["created_at", "source", "event_id", "status", "outcome", "message"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Refund)
class RefundAdmin(admin.ModelAdmin):
    """Read-only: refunds move through the admin API so the money actually follows."""

    list_display = ["reference", "booking", "amount", "status", "created_at", "resolved_at"]
    list_filter = ["status"]
    search_fields = ["reference", "booking__booking_reference", "booking__customer__email"]
    list_select_related = ["booking"]
    date_hierarchy = "created_at"

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in Refund._meta.fields]

    def has_add_permission(self, request) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    """Read-only: payments change through the gateway and the admin API's refund action."""

    list_display = [
        "transaction_reference",
        "booking",
        "provider",
        "amount",
        "status",
        "requires_refund",
        "payment_method",
        "paid_at",
        "created_at",
    ]
    list_filter = ["status", "provider", "requires_refund", "payment_method"]
    search_fields = ["transaction_reference", "provider_reference", "booking__booking_reference"]
    list_select_related = ["booking"]
    date_hierarchy = "created_at"
    inlines = [PaymentEventInline]

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in Payment._meta.fields]

    def has_add_permission(self, request) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
