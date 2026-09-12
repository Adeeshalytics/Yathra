from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.accounts.models import UserRole
from apps.core.fields import PhoneNumberField
from apps.core.models import BaseModel


class OperatorStatus(models.TextChoices):
    PENDING = "pending", "Pending approval"
    ACTIVE = "active", "Active"
    SUSPENDED = "suspended", "Suspended"


class Operator(BaseModel):
    """A bus company. Buses, and through them trips, always belong to exactly one operator."""

    company_name = models.CharField(max_length=200)
    registration_number = models.CharField(
        max_length=64, unique=True, help_text="Business registration number."
    )
    contact_phone = PhoneNumberField()
    contact_email = models.EmailField(max_length=254)
    address = models.TextField()
    status = models.CharField(
        max_length=16, choices=OperatorStatus.choices, default=OperatorStatus.PENDING
    )

    class Meta:
        ordering = ["company_name"]
        indexes = [
            models.Index(fields=["status"], name="operators_operator_status_idx"),
            models.Index(fields=["company_name"], name="operators_operator_name_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=OperatorStatus.values),
                name="operators_operator_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return self.company_name

    @property
    def is_active(self) -> bool:
        return self.status == OperatorStatus.ACTIVE


class OperatorMemberRole(models.TextChoices):
    OWNER = "owner", "Owner"
    MANAGER = "manager", "Manager"
    STAFF = "staff", "Staff"


class OperatorMembership(BaseModel):
    """Links operator-role users to the company they work for (a company can have many staff)."""

    operator = models.ForeignKey(Operator, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="operator_memberships"
    )
    role = models.CharField(
        max_length=16, choices=OperatorMemberRole.choices, default=OperatorMemberRole.STAFF
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["operator", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["operator", "user"], name="operators_membership_unique"
            ),
            models.CheckConstraint(
                condition=Q(role__in=OperatorMemberRole.values),
                name="operators_membership_role_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "is_active"], name="operators_membership_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user} @ {self.operator} ({self.role})"

    def clean(self) -> None:
        if self.user_id and self.user.role != UserRole.OPERATOR:
            raise ValidationError(
                {"user": "Only users with the operator role can be linked to an operator."}
            )
