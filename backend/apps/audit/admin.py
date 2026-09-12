from django.contrib import admin

from .models import ActivityLog


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "actor_email", "action", "entity_type", "entity_label"]
    list_filter = ["action", "entity_type"]
    search_fields = ["entity_label", "actor_email", "entity_id"]
    date_hierarchy = "created_at"

    # The log is append-only: visible to admins, never editable.
    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
