from .models import OperatorMembership, OperatorStatus


def get_active_membership(user) -> OperatorMembership | None:
    """The user's active membership, regardless of the company's approval status."""
    if not getattr(user, "is_authenticated", False):
        return None
    return (
        OperatorMembership.objects.select_related("operator")
        .filter(user=user, is_active=True)
        .order_by("created_at")
        .first()
    )


def get_operational_membership(user) -> OperatorMembership | None:
    """Membership of an *approved* operator — required for any operational action."""
    membership = get_active_membership(user)
    if membership is None or membership.operator.status != OperatorStatus.ACTIVE:
        return None
    return membership
