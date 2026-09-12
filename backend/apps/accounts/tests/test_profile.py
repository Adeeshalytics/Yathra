"""Phase 6: customers manage their own profile — name, phone, email and password."""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.tests.factories import AdminFactory, CustomerFactory

pytestmark = pytest.mark.django_db

ME = "/api/v1/auth/me/"
PASSWORD = "/api/v1/auth/password/"
CURRENT = "Yathra@Dev2026"


def client_for(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def kasuni(db) -> User:
    return CustomerFactory(name="Kasuni Fernando", password=CURRENT)


class TestProfile:
    def test_shows_and_updates_the_signed_in_account(self, kasuni):
        client = client_for(kasuni)

        before = client.get(ME).json()
        updated = client.patch(
            ME, {"name": "Kasuni  Perera", "phone": "077 765 4321"}, format="json"
        )

        assert before["email"] == kasuni.email
        assert updated.status_code == 200, updated.content
        body = updated.json()
        assert body["name"] == "Kasuni Perera"  # tidied up on the way in
        assert body["phone"] == "+94777654321"  # stored in one canonical form
        kasuni.refresh_from_db()
        assert kasuni.name == "Kasuni Perera"

    def test_changes_the_sign_in_email(self, kasuni):
        response = client_for(kasuni).patch(ME, {"email": "Kasuni.New@Example.COM"}, format="json")

        assert response.json()["email"] == "kasuni.new@example.com"

    def test_refuses_an_email_or_phone_someone_else_uses(self, kasuni):
        other = CustomerFactory()
        client = client_for(kasuni)

        email_taken = client.patch(ME, {"email": other.email}, format="json")
        phone_taken = client.patch(ME, {"phone": str(other.phone)}, format="json")

        assert email_taken.status_code == 400
        assert "email" in email_taken.json()["error"]["details"]
        assert phone_taken.status_code == 400
        assert "phone" in phone_taken.json()["error"]["details"]

    def test_refuses_nonsense(self, kasuni):
        client = client_for(kasuni)

        assert client.patch(ME, {"name": "K"}, format="json").status_code == 400
        assert client.patch(ME, {"phone": "12"}, format="json").status_code == 400
        assert client.patch(ME, {"email": "not-an-email"}, format="json").status_code == 400

    def test_cannot_promote_itself(self, kasuni):
        body = (
            client_for(kasuni)
            .patch(ME, {"role": "admin", "is_active": False, "name": "Kasuni F"}, format="json")
            .json()
        )

        kasuni.refresh_from_db()
        assert (body["role"], kasuni.role) == ("customer", "customer")
        assert kasuni.is_active is True

    def test_each_account_only_edits_itself(self, kasuni):
        admin = AdminFactory()

        client_for(admin).patch(ME, {"name": "Admin Only"}, format="json")

        kasuni.refresh_from_db()
        assert kasuni.name == "Kasuni Fernando"


class TestChangePassword:
    def test_swaps_the_password_and_keeps_the_session_alive(self, kasuni):
        client = client_for(kasuni)

        response = client.post(
            PASSWORD, {"current_password": CURRENT, "new_password": "Kandy-Express-2027"}
        )

        assert response.status_code == 200, response.content
        # Tokens carry a hash of the password, so a fresh session comes back with the change.
        assert response.json()["access"]
        assert response.json()["user"]["email"] == kasuni.email
        assert "yathra_refresh" in response.cookies
        kasuni.refresh_from_db()
        assert kasuni.check_password("Kandy-Express-2027")

    def test_the_old_password_stops_working(self, kasuni):
        client_for(kasuni).post(
            PASSWORD, {"current_password": CURRENT, "new_password": "Kandy-Express-2027"}
        )

        signed_in = APIClient().post(
            "/api/v1/auth/login/", {"email": kasuni.email, "password": CURRENT}
        )

        assert signed_in.status_code == 401

    def test_needs_the_current_password(self, kasuni):
        response = client_for(kasuni).post(
            PASSWORD, {"current_password": "not-my-password", "new_password": "Kandy-Express-2027"}
        )

        assert response.status_code == 400
        assert "current_password" in response.json()["error"]["details"]
        kasuni.refresh_from_db()
        assert kasuni.check_password(CURRENT)

    def test_refuses_a_weak_or_unchanged_password(self, kasuni):
        client = client_for(kasuni)

        weak = client.post(PASSWORD, {"current_password": CURRENT, "new_password": "password"})
        same = client.post(PASSWORD, {"current_password": CURRENT, "new_password": CURRENT})

        assert weak.status_code == 400
        assert "new_password" in weak.json()["error"]["details"]
        assert same.status_code == 400

    def test_signed_out_visitors_cannot_change_a_password(self, kasuni):
        response = APIClient().post(
            PASSWORD, {"current_password": CURRENT, "new_password": "Kandy-Express-2027"}
        )

        assert response.status_code == 401
