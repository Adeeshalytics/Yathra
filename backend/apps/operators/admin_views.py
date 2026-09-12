from django.db.models import Count, Q

from apps.core.admin_viewsets import ActivationActionsMixin, AdminModelViewSet

from .admin_serializers import AdminOperatorSerializer
from .models import Operator, OperatorStatus


class AdminOperatorViewSet(ActivationActionsMixin, AdminModelViewSet):
    """Full operator management for platform admins."""

    serializer_class = AdminOperatorSerializer
    filterset_fields = ["status"]
    search_fields = ["company_name", "registration_number", "contact_email", "contact_phone"]
    ordering_fields = ["company_name", "created_at", "status"]
    ordering = ["company_name"]

    def get_queryset(self):
        return Operator.objects.annotate(
            bus_count=Count("buses", distinct=True),
            active_bus_count=Count("buses", filter=Q(buses__active=True), distinct=True),
            member_count=Count("memberships", filter=Q(memberships__is_active=True), distinct=True),
        )

    # Operators use a status instead of a boolean: activate = approve, deactivate = suspend.
    def is_record_active(self, operator: Operator) -> bool:
        return operator.status == OperatorStatus.ACTIVE

    def set_record_active(self, operator: Operator, active: bool) -> None:
        operator.status = OperatorStatus.ACTIVE if active else OperatorStatus.SUSPENDED
        operator.save(update_fields=["status", "updated_at"])

    def get_delete_blocker(self, operator: Operator) -> str | None:
        buses = operator.buses.count()
        if buses:
            return (
                f"{operator.company_name} still has {buses} bus(es). Reassign or delete them "
                "first, or deactivate the operator instead."
            )
        return None
