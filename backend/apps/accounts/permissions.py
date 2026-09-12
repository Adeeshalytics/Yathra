"""
Role-based access control.

Views declare who may call them, e.g. ``permission_classes = [IsOperator]``. Object-level
rules (e.g. "an operator may only touch their own buses") belong in the view's queryset
scoping, so data from other operators is never even loaded.
"""

from rest_framework.permissions import BasePermission

from .models import UserRole


class HasRole(BasePermission):
    allowed_roles: tuple[str, ...] = ()
    message = "You do not have permission to perform this action."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.is_active
            and getattr(user, "role", None) in self.allowed_roles
        )


class IsCustomer(HasRole):
    allowed_roles = (UserRole.CUSTOMER,)
    message = "This action is only available to customer accounts."


class IsOperator(HasRole):
    allowed_roles = (UserRole.OPERATOR,)
    message = "This action is only available to bus operator accounts."


class IsAdmin(HasRole):
    allowed_roles = (UserRole.ADMIN,)
    message = "This action is only available to administrators."


class IsAdminOrOperator(HasRole):
    allowed_roles = (UserRole.ADMIN, UserRole.OPERATOR)
