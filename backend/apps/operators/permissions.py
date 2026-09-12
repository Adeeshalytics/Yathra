from apps.accounts.permissions import IsOperator

from .selectors import get_operational_membership


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
        return True
