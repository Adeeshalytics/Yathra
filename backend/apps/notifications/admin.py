from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["created_at", "kind", "channel", "recipient", "status", "attempts", "sent_at"]
    list_filter = ["status", "channel", "kind"]
    search_fields = ["recipient", "booking__booking_reference", "provider_message_id"]
    list_select_related = ["booking"]
    date_hierarchy = "created_at"
    readonly_fields = [field.name for field in Notification._meta.fields]

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False
