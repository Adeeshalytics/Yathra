from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.core.validators import normalize_phone_number

from .models import User, normalize_email
from .services import register_customer


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "name", "email", "phone", "role", "is_active", "created_at", "updated_at"]
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=254)
    phone = serializers.CharField(max_length=32)
    password = serializers.CharField(
        write_only=True, max_length=128, trim_whitespace=False, style={"input_type": "password"}
    )

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Please enter your full name.")
        return value

    def validate_email(self, value: str) -> str:
        email = normalize_email(value)
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_phone(self, value: str) -> str:
        try:
            phone = normalize_phone_number(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        if User.objects.filter(phone=phone).exists():
            raise serializers.ValidationError("An account with this phone number already exists.")
        return phone

    def validate(self, attrs: dict) -> dict:
        candidate = User(name=attrs["name"], email=attrs["email"], phone=attrs["phone"])
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def create(self, validated_data: dict) -> User:
        return register_customer(**validated_data)


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """What a signed-in user may change about themselves: never their role or status."""

    class Meta:
        model = User
        fields = ["name", "phone", "email"]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Please enter your full name.")
        return value

    def validate_email(self, value: str) -> str:
        email = normalize_email(value)
        if User.objects.filter(email=email).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_phone(self, value: str) -> str:
        try:
            phone = normalize_phone_number(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        if User.objects.filter(phone=phone).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError("An account with this phone number already exists.")
        return phone


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        write_only=True, trim_whitespace=False, style={"input_type": "password"}
    )
    new_password = serializers.CharField(
        write_only=True, max_length=128, trim_whitespace=False, style={"input_type": "password"}
    )

    def validate_current_password(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("That isn’t your current password.")
        return value

    def validate(self, attrs: dict) -> dict:
        user = self.context["request"].user
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": ["Choose a password you aren’t already using."]}
            )
        try:
            validate_password(attrs["new_password"], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)}) from exc
        return attrs

    def save(self, **kwargs) -> User:
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password", "updated_at"])
        return user


class LoginSerializer(TokenObtainPairSerializer):
    """Email + password login shared by customers, operators and admins."""

    default_error_messages = {"no_active_account": "Incorrect email or password."}

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # Informational claims for clients. Authorisation always re-reads the role from the DB.
        token["role"] = user.role
        return token

    def validate(self, attrs: dict) -> dict:
        attrs[self.username_field] = normalize_email(attrs.get(self.username_field, ""))
        return super().validate(attrs)


class AuthResponseSerializer(serializers.Serializer):
    """Shape of successful login / register / refresh responses (for the OpenAPI schema)."""

    access = serializers.CharField()
    user = UserSerializer()


class LogoutRequestSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False, help_text="Only needed by non-browser clients.")
