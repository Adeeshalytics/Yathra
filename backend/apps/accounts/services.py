from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from apps.core.db import violated_constraint

from .models import User, UserRole


@transaction.atomic
def register_customer(*, name: str, email: str, phone: str, password: str) -> User:
    """
    Create a customer account. The serializer pre-checks uniqueness for friendly errors;
    the database constraints are the real guarantee when two sign-ups race.
    """
    try:
        with transaction.atomic():
            return User.objects.create_user(
                email=email, password=password, name=name, phone=phone, role=UserRole.CUSTOMER
            )
    except IntegrityError as exc:
        constraint = violated_constraint(exc)
        if "phone" in constraint:
            raise ValidationError(
                {"phone": ["An account with this phone number already exists."]}
            ) from exc
        if "email" in constraint:
            raise ValidationError(
                {"email": ["An account with this email already exists."]}
            ) from exc
        raise
