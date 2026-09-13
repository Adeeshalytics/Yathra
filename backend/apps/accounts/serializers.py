from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.core.validators import normalize_phone_number

from .models import User, normalize_email
from .services import register_customer


class UserSerializer(serializers.ModelSerializer):
    has_password = serializers.SerializerMethodField(
        help_text="False for customers who sign in with codes texted to their phone."
    )
    phone_verified = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "name",
            "email",
            "phone",
            "phone_verified",
            "has_password",
            "role",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_has_password(self, user: User) -> bool:
        return user.has_usable_password()

    def get_phone_verified(self, user: User) -> bool:
        return user.phone_verified_at is not None


def clean_phone(value: str) -> str:
    try:
        return normalize_phone_number(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(exc.messages) from exc


class PhoneCodeRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(
        max_length=32, error_messages={"blank": "Enter your mobile number."}
    )

    def validate_phone(self, value: str) -> str:
        phone = clean_phone(value)
        if not phone:
            raise serializers.ValidationError("Enter your mobile number.")
        return phone


class PhoneCodeVerifySerializer(PhoneCodeRequestSerializer):
    code = serializers.RegexField(
        r"^\s*\d{6}\s*$",
        error_messages={
            "invalid": "Enter the 6-digit code we texted you.",
            "blank": "Enter the 6-digit code we texted you.",
        },
    )

    def validate_code(self, value: str) -> str:
        return value.strip()


class PhoneCodeSentSerializer(serializers.Serializer):
    phone = serializers.CharField()
    masked_phone = serializers.CharField()
    code_length = serializers.IntegerField()
    expires_in = serializers.IntegerField(help_text="Seconds until the code stops working.")
    resend_in = serializers.IntegerField(help_text="Seconds before another code can be sent.")


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

    def validate_email(self, value: str | None) -> str | None:
        email = normalize_email(value) or None
        if email is None:
            if self.instance.has_usable_password():
                raise serializers.ValidationError(
                    "You sign in with this email, so it can’t be removed."
                )
            return None
        if User.objects.filter(email=email).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_phone(self, value: str) -> str:
        phone = clean_phone(value)
        if not self.instance.has_usable_password() and phone != self.instance.phone:
            # The number is this account's only way in; it moves only through support.
            raise serializers.ValidationError(
                "You sign in with this number, so it can’t be changed here. "
                "Please contact our support team."
            )
        if phone and User.objects.filter(phone=phone).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError("An account with this phone number already exists.")
        return phone

    def update(self, instance: User, validated_data: dict) -> User:
        if "phone" in validated_data and validated_data["phone"] != instance.phone:
            # A new number hasn't been proven with a code yet.
            instance.phone_verified_at = None
        return super().update(instance, validated_data)


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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Sent after a texted code met an account with a password: signing in links the phone.
        self.fields["phone_proof"] = serializers.CharField(
            required=False, write_only=True, max_length=512
        )

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # Informational claims for clients. Authorisation always re-reads the role from the DB.
        token["role"] = user.role
        return token

    def validate(self, attrs: dict) -> dict:
        attrs[self.username_field] = normalize_email(attrs.get(self.username_field, ""))
        self.phone_proof = attrs.pop("phone_proof", "")
        return super().validate(attrs)


class AuthResponseSerializer(serializers.Serializer):
    """Shape of successful login / register / refresh responses (for the OpenAPI schema)."""

    access = serializers.CharField()
    user = UserSerializer()


class LogoutRequestSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False, help_text="Only needed by non-browser clients.")
