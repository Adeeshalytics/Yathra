from django.contrib import admin

from .models import Operator, OperatorMembership


class OperatorMembershipInline(admin.TabularInline):
    model = OperatorMembership
    extra = 0
    autocomplete_fields = ["user"]
    fields = ["user", "role", "is_active", "created_at"]
    readonly_fields = ["created_at"]


@admin.register(Operator)
class OperatorAdmin(admin.ModelAdmin):
    list_display = ["company_name", "registration_number", "contact_phone", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["company_name", "registration_number", "contact_email", "contact_phone"]
    readonly_fields = ["id", "created_at", "updated_at"]
    inlines = [OperatorMembershipInline]


@admin.register(OperatorMembership)
class OperatorMembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "operator", "role", "is_active", "created_at"]
    list_filter = ["role", "is_active"]
    search_fields = ["user__email", "operator__company_name"]
    autocomplete_fields = ["user", "operator"]
    list_select_related = ["user", "operator"]
