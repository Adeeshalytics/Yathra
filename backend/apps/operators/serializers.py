from rest_framework import serializers

from .models import Operator, OperatorMembership


class OperatorSerializer(serializers.ModelSerializer):
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
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class OperatorProfileSerializer(serializers.ModelSerializer):
    operator = OperatorSerializer(read_only=True)

    class Meta:
        model = OperatorMembership
        fields = ["role", "operator"]
        read_only_fields = fields
