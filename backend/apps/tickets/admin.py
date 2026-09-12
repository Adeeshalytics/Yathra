from django.contrib import admin

from .models import Ticket


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ["ticket_number", "booking", "status", "issued_at"]
    search_fields = ["ticket_number", "booking__booking_reference"]
    list_select_related = ["booking"]
    readonly_fields = ["id", "ticket_number", "booking", "issued_at", "created_at", "updated_at"]
    date_hierarchy = "issued_at"

    @admin.display(description="Status")
    def status(self, ticket: Ticket) -> str:
        return ticket.status

    def has_add_permission(self, request) -> bool:
        return False
