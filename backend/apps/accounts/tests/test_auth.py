import pytest
from django.conf import settings
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User, UserRole
from apps.core.tests.factories import CustomerFactory

pytestmark = pytest.mark.django_db

REGISTER_URL = "/api/v1/auth/register/"
LOGIN_URL = "/api/v1/auth/login/"
REFRESH_URL = "/api/v1/auth/refresh/"
LOGOUT_URL = "/api/v1/auth/logout/"
ME_URL = "/api/v1/auth/me/"
COOKIE = settings.JWT_REFRESH_COOKIE["NAME"]


def is_blacklisted(raw_refresh: str) -> bool:
    jti = RefreshToken(raw_refresh, verify=False)["jti"]
    return BlacklistedToken.objects.filter(token__jti=jti).exists()


def registration_payload(**overrides):
    return {
        "name": "Kasuni Fernando",
        "email": "Kasuni@Example.com",
        "phone": "077 123 4567",
        "password": "Str0ng-Test-Pass!",
        **overrides,
    }


class TestRegistration:
    def test_creates_customer_and_starts_session(self, api_client):
        response = api_client.post(REGISTER_URL, registration_payload(), format="json")

        assert response.status_code == 201, response.content
        body = response.json()
        assert body["access"]
        assert body["user"]["email"] == "kasuni@example.com"
        assert body["user"]["phone"] == "+94771234567"
        assert body["user"]["role"] == UserRole.CUSTOMER
        assert "password" not in body["user"]

        cookie = response.cookies[COOKIE]
        assert cookie.value
        assert cookie["httponly"]
        assert cookie["path"] == "/api/v1/auth/"

    def test_password_is_hashed_never_stored_in_plaintext(self, api_client):
        api_client.post(REGISTER_URL, registration_payload(), format="json")

        user = User.objects.get(email="kasuni@example.com")
        assert user.password != "Str0ng-Test-Pass!"
        assert user.check_password("Str0ng-Test-Pass!")

    def test_cannot_self_register_as_admin(self, api_client):
        response = api_client.post(REGISTER_URL, registration_payload(role="admin"), format="json")

        assert response.status_code == 201
        assert response.json()["user"]["role"] == UserRole.CUSTOMER

    def test_rejects_duplicate_email_case_insensitively(self, api_client):
        CustomerFactory(email="kasuni@example.com")

        response = api_client.post(REGISTER_URL, registration_payload(), format="json")

        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "validation_error"
        assert "email" in error["details"]

    def test_rejects_duplicate_phone(self, api_client):
        CustomerFactory(phone="+94771234567")

        response = api_client.post(REGISTER_URL, registration_payload(), format="json")

        assert response.status_code == 400
        assert "phone" in response.json()["error"]["details"]

    @pytest.mark.parametrize(
        ("field", "value"),
        [("phone", "12345"), ("password", "password"), ("email", "not-an-email"), ("name", "")],
    )
    def test_validates_fields(self, api_client, field, value):
        response = api_client.post(
            REGISTER_URL, registration_payload(**{field: value}), format="json"
        )

        assert response.status_code == 400
        assert field in response.json()["error"]["details"]


class TestLogin:
    def test_returns_access_token_and_sets_refresh_cookie(self, api_client, customer, password):
        response = api_client.post(
            LOGIN_URL, {"email": customer.email.upper(), "password": password}, format="json"
        )

        assert response.status_code == 200
        assert response.json()["user"]["id"] == str(customer.id)
        assert "refresh" not in response.json()
        assert response.cookies[COOKIE]["httponly"]

    @pytest.mark.parametrize("role_fixture", ["customer", "operator_user", "admin_user"])
    def test_every_role_can_log_in(self, request, api_client, password, role_fixture):
        user = request.getfixturevalue(role_fixture)

        response = api_client.post(
            LOGIN_URL, {"email": user.email, "password": password}, format="json"
        )

        assert response.status_code == 200
        assert response.json()["user"]["role"] == user.role

    def test_wrong_password_is_rejected(self, api_client, customer):
        response = api_client.post(
            LOGIN_URL, {"email": customer.email, "password": "wrong-password"}, format="json"
        )

        assert response.status_code == 401
        assert response.json()["error"]["message"] == "Incorrect email or password."

    def test_inactive_user_cannot_log_in(self, api_client, customer, password):
        customer.is_active = False
        customer.save()

        response = api_client.post(
            LOGIN_URL, {"email": customer.email, "password": password}, format="json"
        )

        assert response.status_code == 401


class TestSession:
    def test_me_requires_a_valid_access_token(self, api_client, customer, authenticate):
        assert api_client.get(ME_URL).status_code == 401

        authenticate(customer)
        response = api_client.get(ME_URL)

        assert response.status_code == 200
        assert response.json()["email"] == customer.email

    def test_refresh_rotates_the_refresh_token(self, api_client, customer, password):
        api_client.post(LOGIN_URL, {"email": customer.email, "password": password}, format="json")
        original = api_client.cookies[COOKIE].value

        response = api_client.post(REFRESH_URL)

        assert response.status_code == 200
        assert response.json()["access"]
        assert response.json()["user"]["id"] == str(customer.id)
        assert response.cookies[COOKIE].value != original
        assert is_blacklisted(original)

    def test_reusing_a_rotated_refresh_token_fails(self, api_client, customer, password):
        api_client.post(LOGIN_URL, {"email": customer.email, "password": password}, format="json")
        original = api_client.cookies[COOKIE].value
        api_client.post(REFRESH_URL)

        api_client.cookies[COOKIE] = original
        response = api_client.post(REFRESH_URL)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "token_not_valid"

    def test_refresh_without_session_is_unauthorized(self, api_client):
        response = api_client.post(REFRESH_URL)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "not_authenticated"

    def test_refresh_fails_for_deactivated_user(self, api_client, customer, password):
        api_client.post(LOGIN_URL, {"email": customer.email, "password": password}, format="json")
        customer.is_active = False
        customer.save()

        assert api_client.post(REFRESH_URL).status_code == 401

    def test_password_change_revokes_existing_tokens(self, api_client, customer, authenticate):
        authenticate(customer)
        customer.set_password("An0ther-Strong-Pass!")
        customer.save()

        assert api_client.get(ME_URL).status_code == 401
        assert api_client.post(REFRESH_URL).status_code == 401

    def test_logout_blacklists_token_and_clears_cookie(self, api_client, customer, password):
        api_client.post(LOGIN_URL, {"email": customer.email, "password": password}, format="json")
        refresh = api_client.cookies[COOKIE].value

        response = api_client.post(LOGOUT_URL)

        assert response.status_code == 204
        assert response.cookies[COOKIE].value == ""
        assert is_blacklisted(refresh)

        api_client.cookies[COOKIE] = refresh
        assert api_client.post(REFRESH_URL).status_code == 401
