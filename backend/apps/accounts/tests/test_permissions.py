import pytest
from rest_framework.test import APIRequestFactory

from apps.core.tests.factories import (
    BookingFactory,
    OperatorFactory,
    OperatorMembershipFactory,
    OperatorUserFactory,
)
from apps.operators.models import OperatorStatus
from apps.operators.permissions import IsActiveOperatorMember

pytestmark = pytest.mark.django_db

BOOKINGS_URL = "/api/v1/bookings/"
ADMIN_OPERATORS_URL = "/api/v1/admin/operators/"
OPERATOR_PROFILE_URL = "/api/v1/operator/profile/"


class TestCustomerOnlyEndpoints:
    def test_customer_sees_only_their_own_bookings(self, authenticate, customer):
        mine = BookingFactory(customer=customer)
        BookingFactory()  # someone else's

        response = authenticate(customer).get(BOOKINGS_URL)

        assert response.status_code == 200
        references = [b["booking_reference"] for b in response.json()["results"]]
        assert references == [mine.booking_reference]

    def test_customer_cannot_read_another_customers_booking(self, authenticate, customer):
        other = BookingFactory()

        response = authenticate(customer).get(f"{BOOKINGS_URL}{other.pk}/")

        assert response.status_code == 404

    def test_operators_are_forbidden(self, authenticate, operator_user):
        response = authenticate(operator_user).get(BOOKINGS_URL)

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "permission_denied"

    def test_admins_see_every_booking(self, authenticate, admin_user):
        booking = BookingFactory()

        response = authenticate(admin_user).get(BOOKINGS_URL)

        assert response.status_code == 200
        assert [b["booking_reference"] for b in response.json()["results"]] == [
            booking.booking_reference
        ]

    def test_anonymous_is_unauthorized(self, api_client):
        assert api_client.get(BOOKINGS_URL).status_code == 401


class TestAdminOnlyEndpoints:
    def test_admin_can_list_operators(self, authenticate, admin_user):
        OperatorFactory(company_name="Zeta Coaches")

        response = authenticate(admin_user).get(ADMIN_OPERATORS_URL)

        assert response.status_code == 200
        assert response.json()["results"][0]["company_name"] == "Zeta Coaches"
        assert response.json()["results"][0]["bus_count"] == 0

    @pytest.mark.parametrize("role_fixture", ["customer", "operator_user"])
    def test_other_roles_are_forbidden(self, request, authenticate, role_fixture):
        user = request.getfixturevalue(role_fixture)

        assert authenticate(user).get(ADMIN_OPERATORS_URL).status_code == 403


class TestOperatorEndpoints:
    def test_operator_sees_their_company(self, authenticate, operator_user):
        response = authenticate(operator_user).get(OPERATOR_PROFILE_URL)

        assert response.status_code == 200
        membership = operator_user.operator_memberships.get()
        assert response.json()["operator"]["id"] == str(membership.operator_id)
        assert response.json()["role"] == "owner"

    def test_operator_without_company_gets_404(self, authenticate, password):
        user = OperatorUserFactory(password=password)

        assert authenticate(user).get(OPERATOR_PROFILE_URL).status_code == 404

    def test_customer_is_forbidden(self, authenticate, customer):
        assert authenticate(customer).get(OPERATOR_PROFILE_URL).status_code == 403


class TestIsActiveOperatorMember:
    def _check(self, user) -> bool:
        request = APIRequestFactory().get("/")
        request.user = user
        return IsActiveOperatorMember().has_permission(request, view=None)

    def test_allows_member_of_active_operator(self):
        membership = OperatorMembershipFactory()
        assert self._check(membership.user)

    def test_denies_member_of_pending_operator(self):
        membership = OperatorMembershipFactory(operator__status=OperatorStatus.PENDING)
        assert not self._check(membership.user)

    def test_denies_inactive_membership(self):
        membership = OperatorMembershipFactory(is_active=False)
        assert not self._check(membership.user)

    def test_denies_customers(self, customer):
        assert not self._check(customer)
