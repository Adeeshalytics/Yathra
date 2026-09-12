import re

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.core.validators import normalize_phone_number

from .models import Operator

REGISTRATION_PATTERN = re.compile(r"[A-Z0-9][A-Z0-9 /-]{2,63}")


class AdminOperatorSerializer(serializers.ModelSerializer):
    contact_phone = serializers.CharField(max_length=32)
    bus_count = serializers.IntegerField(read_only=True)
    active_bus_count = serializers.IntegerField(read_only=True)
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Operator
        fields = [
            "id",
            "company_name",
            "registration_number",
            "contact_phone",
            "contact_email",
            "address",
            "status",
            "bus_count",
            "active_bus_count",
            "member_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        # Uniqueness is checked case-insensitively in validate_registration_number.
        extra_kwargs = {"registration_number": {"validators": []}}

    def validate_company_name(self, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Enter the company name.")
        return value

    def validate_registration_number(self, value: str) -> str:
        value = " ".join(value.upper().split())
        if not REGISTRATION_PATTERN.fullmatch(value):
            raise serializers.ValidationError(
                "Use letters, digits, spaces, slashes or dashes, e.g. PV-00012345."
            )
        clash = Operator.objects.filter(registration_number__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                "An operator with this registration number already exists."
            )
        return value

    def validate_contact_phone(self, value: str) -> str:
        try:
            phone = normalize_phone_number(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        if not phone:
            raise serializers.ValidationError("Enter a contact phone number.")
        return phone

    def validate_contact_email(self, value: str) -> str:
        return value.strip().lower()

    def validate_address(self, value: str) -> str:
        value = value.strip()
        if len(value) < 5:
            raise serializers.ValidationError("Enter the full business address.")
        return value
