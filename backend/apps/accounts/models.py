from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models import Q
from django.utils.timezone import now

from apps.core.fields import PhoneNumberField
from apps.core.models import BaseModel


class UserRole(models.TextChoices):
    CUSTOMER = "customer", "Customer"
    OPERATOR = "operator", "Operator"
    ADMIN = "admin", "Admin"


def normalize_email(email: str) -> str:
    """Emails are stored lower-cased so uniqueness and login are case-insensitive."""
    return (email or "").strip().lower()


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra_fields) -> "User":
        if not email:
            raise ValueError("An email address is required.")
        user = self.model(email=normalize_email(email), **extra_fields)
        user.set_password(password)  # None produces an unusable password
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra_fields) -> "User":
        extra_fields.setdefault("role", UserRole.CUSTOMER)
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email: str, password: str | None = None, **extra_fields) -> "User":
        extra_fields.setdefault("role", UserRole.ADMIN)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields["role"] != UserRole.ADMIN:
            raise ValueError("Superusers must have the admin role.")
        if not extra_fields["is_staff"] or not extra_fields["is_superuser"]:
            raise ValueError("Superusers must have is_staff=True and is_superuser=True.")
        return self._create_user(email, password, **extra_fields)

    def get_by_natural_key(self, username: str) -> "User":
        return self.get(**{self.model.USERNAME_FIELD: normalize_email(username)})

    def create_phone_customer(self, phone: str, *, name: str = "") -> "User":
        """A customer who signs in with codes texted to their phone: no e-mail, no password."""
        user = self.model(
            phone=phone, name=name, role=UserRole.CUSTOMER, email=None, phone_verified_at=now()
        )
        user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(BaseModel, AbstractBaseUser, PermissionsMixin):
    """
    A single user table for every role. `role` drives API authorisation; `is_staff`
    separately controls access to the Django admin site.
    Passwords are only ever stored as salted Argon2 hashes (see PASSWORD_HASHERS).
    """

    name = models.CharField(max_length=150, blank=True)
    # Customers who book with just a phone number have no e-mail (NULL, so they don't clash).
    email = models.EmailField(max_length=254, unique=True, null=True, blank=True)
    phone = PhoneNumberField(blank=True)
    phone_verified_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the user proved the phone is theirs with a texted code.",
    )
    role = models.CharField(max_length=16, choices=UserRole.choices, default=UserRole.CUSTOMER)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(
        default=False, help_text="Designates whether the user can log into the Django admin site."
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["phone"], condition=~Q(phone=""), name="accounts_user_phone_unique"
            ),
            models.CheckConstraint(
                condition=Q(role__in=UserRole.values), name="accounts_user_role_valid"
            ),
        ]
        indexes = [models.Index(fields=["role", "is_active"], name="accounts_user_role_active_idx")]

    def __str__(self) -> str:
        return self.email or self.phone or str(self.pk)

    def save(self, *args, **kwargs):
        self.email = normalize_email(self.email) or None
        super().save(*args, **kwargs)

    def get_full_name(self) -> str:
        return self.name

    def get_short_name(self) -> str:
        return self.name.split(" ")[0] if self.name else str(self)

    @property
    def is_customer(self) -> bool:
        return self.role == UserRole.CUSTOMER

    @property
    def is_operator(self) -> bool:
        return self.role == UserRole.OPERATOR

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN


class PhoneVerification(BaseModel):
    """
    A sign-in code texted to a phone. Only a keyed hash of the code is kept; it works once,
    for a few minutes, and only for a handful of guesses. Asking for a new code retires the old.
    """

    phone = PhoneNumberField()
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(
        null=True, blank=True, help_text="Used, replaced by a newer code, or locked out."
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["phone", "-created_at"], name="accounts_phone_code_recent_idx"),
        ]

    def __str__(self) -> str:
        return f"Sign-in code for {self.phone}"
