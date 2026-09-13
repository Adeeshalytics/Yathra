from apps.accounts.permissions import IsOperator

from .models import OperatorMemberRole
from .selectors import get_operational_membership

MANAGER_ROLES = (OperatorMemberRole.OWNER, OperatorMemberRole.MANAGER)


class IsActiveOperatorMember(IsOperator):
    """
    Operator-role user whose company is approved. Views using this can read the company
    from ``request.operator`` and must scope every queryset to it.
    """

    message = "Your operator account is not active. Please contact support."

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        membership = get_operational_membership(request.user)
        if membership is None:
            return False
        request.operator = membership.operator
        request.operator_membership = membership
        return True


class IsOperatorManager(IsActiveOperatorMember):
    """An owner or manager of an approved operator: the people who may see the company's money."""

    message = "Only the company's owners and managers can see this."

    def has_permission(self, request, view) -> bool:
        return (
            super().has_permission(request, view)
            and request.operator_membership.role in MANAGER_ROLES
        )
