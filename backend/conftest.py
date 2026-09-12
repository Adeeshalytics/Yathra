import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.core.tests.factories import (
    AdminFactory,
    CustomerFactory,
    OperatorMembershipFactory,
    OperatorUserFactory,
)

DEFAULT_PASSWORD = "Str0ng-Test-Pass!"


@pytest.fixture(autouse=True)
def _clear_cache():
    # Throttle counters live in the cache; never let one test's requests count against another.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def password() -> str:
    return DEFAULT_PASSWORD


@pytest.fixture
def customer(db, password):
    return CustomerFactory(password=password)


@pytest.fixture
def operator_user(db, password):
    user = OperatorUserFactory(password=password)
    OperatorMembershipFactory(user=user)
    return user


@pytest.fixture
def admin_user(db, password):
    return AdminFactory(password=password)


@pytest.fixture
def admin_api(admin_user) -> APIClient:
    """An API client already authenticated as a platform admin."""
    client = APIClient()
    client.force_authenticate(admin_user)
    return client


@pytest.fixture
def authenticate(api_client, password):
    """Log a user in through the real login endpoint and attach the bearer token."""

    def _login(user):
        response = api_client.post(
            "/api/v1/auth/login/", {"email": user.email, "password": password}, format="json"
        )
        assert response.status_code == 200, response.content
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        return api_client

    return _login
