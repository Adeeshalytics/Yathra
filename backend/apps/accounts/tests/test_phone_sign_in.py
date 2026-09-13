"""
Signing in with a phone number: a texted code, no password, and an account made on the spot.
"""

import json
import logging
import re
from datetime import timedelta

import pytest
from django.conf import settings
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import PhoneVerification, User, UserRole
from apps.accounts.phone import make_phone_proof
from apps.core.logging import EVENT_LOGGER
from apps.core.tests.factories import AdminFactory, CustomerFactory, OperatorUserFactory
from apps.notifications import sms

pytestmark = pytest.mark.django_db

CODE_URL = "/api/v1/auth/phone/code/"
VERIFY_URL = "/api/v1/auth/phone/verify/"
LOGIN_URL = "/api/v1/auth/login/"
ME_URL = "/api/v1/auth/me/"
PHONE = "+94771234567"
COOKIE = settings.JWT_REFRESH_COOKIE["NAME"]


@pytest.fixture(autouse=True)
def empty_outbox():
    sms.outbox.clear()
    yield
    sms.outbox.clear()


def ask(client, phone=PHONE):
    return client.post(CODE_URL, {"phone": phone}, format="json")


def texted_code(phone=PHONE) -> str:
    text = next(m["text"] for m in reversed(sms.outbox) if m["to"] == phone)
    return re.match(r"(\d{6}) is your", text).group(1)


def verify(client, code, phone=PHONE):
    return client.post(VERIFY_URL, {"phone": phone, "code": code}, format="json")


def wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


def age_codes(seconds: int, phone=PHONE):
    """Pretend the phone's codes were asked for `seconds` ago (past the resend cooldown)."""
    PhoneVerification.objects.filter(phone=phone).update(
        created_at=timezone.now() - timedelta(seconds=seconds)
    )


class TestAskingForACode:
    def test_a_code_is_texted(self, api_client):
        response = ask(api_client, "077 123 4567")

        assert response.status_code == 202
        body = response.json()
        assert body["phone"] == PHONE
        assert body["masked_phone"] == "+9477*****67"
        assert (body["code_length"], body["expires_in"], body["resend_in"]) == (6, 300, 60)
        assert len(sms.outbox) == 1
        text = sms.outbox[0]["text"]
        assert re.match(r"^\d{6} is your Yathra sign-in code", text)
        # Android can fill the code in by itself.
        assert text.endswith(f"@localhost #{texted_code()}")

    def test_the_code_itself_is_never_stored_or_logged(self, api_client, caplog):
        caplog.set_level(logging.INFO)

        ask(api_client)
        code = texted_code()

        verification = PhoneVerification.objects.get()
        assert code not in verification.code_hash
        assert len(verification.code_hash) == 64
        from apps.notifications.models import Notification

        assert code not in Notification.objects.get().body
        logged = " ".join(
            json.dumps(r.__dict__, default=str) for r in caplog.records if r.name == EVENT_LOGGER
        )
        assert code not in logged and PHONE not in logged

    def test_asking_again_straight_away_is_refused(self, api_client):
        ask(api_client)

        response = ask(api_client)

        assert response.status_code == 429
        assert response.json()["error"]["details"]["retry_after"] > 0
        assert len(sms.outbox) == 1

    def test_a_phone_gets_only_a_few_codes_an_hour(self, api_client):
        for _ in range(5):
            assert ask(api_client).status_code == 202
            age_codes(61)

        assert ask(api_client).status_code == 429
        assert len(sms.outbox) == 5

    def test_a_new_code_retires_the_old_one(self, api_client):
        ask(api_client)
        first = texted_code()
        age_codes(61)
        ask(api_client)
        second = texted_code()

        if first != second:
            assert verify(api_client, first).json()["error"]["code"] == "code_invalid"
        assert verify(APIClient(), second).status_code in (200, 201)

    def test_a_nonsense_number_is_a_field_error(self, api_client):
        response = ask(api_client, "12")

        assert response.status_code == 400
        assert "phone" in response.json()["error"]["details"]
        assert sms.outbox == []

    @pytest.mark.parametrize("factory", [OperatorUserFactory, AdminFactory])
    def test_staff_numbers_get_the_same_answer_but_no_text(self, api_client, factory):
        factory(phone=PHONE)

        response = ask(api_client)

        assert response.status_code == 202
        assert sms.outbox == []

    @override_settings(SMS={"BACKEND": ""})
    def test_without_text_messages_it_points_to_email(self, api_client):
        response = ask(api_client)

        assert response.status_code == 503
        assert response.json()["error"]["code"] == "sms_unavailable"

    def test_a_text_that_cannot_be_sent_is_reported(self, api_client, monkeypatch):
        from apps.notifications.sms import LocmemBackend, SmsError

        def refuse(self, to, text):
            raise SmsError("Invalid number", retryable=False)

        monkeypatch.setattr(LocmemBackend, "send", refuse)

        response = ask(api_client)

        assert response.status_code == 503
        assert response.json()["error"]["code"] == "sms_failed"
        assert PhoneVerification.objects.get().consumed_at is not None


class TestSigningInWithTheCode:
    def test_a_new_number_becomes_a_customer_account(self, api_client):
        ask(api_client)

        response = verify(api_client, texted_code())

        assert response.status_code == 201
        body = response.json()
        assert body["created"] is True
        assert body["access"]
        assert COOKIE in response.cookies
        user = User.objects.get(phone=PHONE)
        assert (user.role, user.email, user.name) == (UserRole.CUSTOMER, None, "")
        assert user.has_usable_password() is False
        assert user.phone_verified_at is not None
        assert body["user"]["has_password"] is False
        assert body["user"]["phone_verified"] is True

        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['access']}")
        assert api_client.get(ME_URL).json()["phone"] == PHONE

    def test_the_same_number_signs_back_into_the_same_account(self, api_client):
        ask(api_client)
        first = verify(api_client, texted_code()).json()
        age_codes(61)

        ask(api_client)
        again = verify(APIClient(), texted_code())

        assert again.status_code == 200
        assert again.json()["created"] is False
        assert again.json()["user"]["id"] == first["user"]["id"]
        assert User.objects.filter(phone=PHONE).count() == 1

    def test_a_verified_customer_with_a_password_can_use_a_code_too(self, api_client):
        customer = CustomerFactory(phone=PHONE, phone_verified_at=timezone.now())
        ask(api_client)

        response = verify(api_client, texted_code())

        assert response.status_code == 200
        assert response.json()["user"]["id"] == str(customer.pk)

    def test_a_code_works_only_once(self, api_client):
        ask(api_client)
        code = texted_code()
        assert verify(api_client, code).status_code == 201

        response = verify(APIClient(), code)

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "code_expired"

    def test_an_expired_code_does_not_work(self, api_client):
        ask(api_client)
        PhoneVerification.objects.update(expires_at=timezone.now() - timedelta(seconds=1))

        response = verify(api_client, texted_code())

        assert response.json()["error"]["code"] == "code_expired"
        assert not User.objects.filter(phone=PHONE).exists()

    def test_wrong_guesses_count_down_and_then_lock_the_code(self, api_client):
        ask(api_client)
        code = texted_code()

        lefts = [
            verify(api_client, wrong(code)).json()["error"]["details"]["attempts_left"]
            for _ in range(5)
        ]

        assert lefts == [4, 3, 2, 1, 0]
        # Even the right code is useless now.
        response = verify(api_client, code)
        assert response.json()["error"]["code"] == "code_expired"
        assert not User.objects.filter(phone=PHONE).exists()

    def test_a_code_for_one_number_does_not_open_another(self, api_client):
        ask(api_client)

        response = verify(api_client, texted_code(), phone="+94770000000")

        assert response.status_code == 400
        assert not User.objects.exists()

    @pytest.mark.parametrize("code", ["", "12345", "1234567", "abcdef"])
    def test_a_code_must_be_six_digits(self, api_client, code):
        response = verify(api_client, code)

        assert response.status_code == 400
        assert "code" in response.json()["error"]["details"]

    def test_an_inactive_customer_is_not_texted_a_working_code(self, api_client):
        CustomerFactory(phone=PHONE, is_active=False, phone_verified_at=timezone.now())

        assert ask(api_client).status_code == 202
        assert sms.outbox == []
        assert verify(api_client, "123456").status_code == 400


class TestAnAccountThatAlreadyHasAPassword:
    def test_the_number_is_linked_only_after_one_password_sign_in(self, api_client, password):
        customer = CustomerFactory(phone=PHONE, password=password)
        ask(api_client)

        refused = verify(api_client, texted_code())

        assert refused.status_code == 409
        error = refused.json()["error"]
        assert error["code"] == "password_required"
        assert COOKIE not in refused.cookies
        proof = error["details"]["phone_proof"]

        signed_in = APIClient().post(
            LOGIN_URL,
            {"email": customer.email, "password": password, "phone_proof": proof},
            format="json",
        )
        assert signed_in.status_code == 200
        customer.refresh_from_db()
        assert customer.phone_verified_at is not None
        assert signed_in.json()["user"]["phone_verified"] is True

        # From now on the code alone is enough.
        age_codes(61)
        ask(api_client)
        assert verify(APIClient(), texted_code()).json()["user"]["id"] == str(customer.pk)

    def test_a_proof_for_another_number_links_nothing(self, api_client, password):
        customer = CustomerFactory(password=password)

        response = api_client.post(
            LOGIN_URL,
            {
                "email": customer.email,
                "password": password,
                "phone_proof": make_phone_proof("+94779999999"),
            },
            format="json",
        )

        assert response.status_code == 200
        customer.refresh_from_db()
        assert customer.phone_verified_at is None

    def test_a_forged_proof_links_nothing(self, api_client, password):
        customer = CustomerFactory(phone=PHONE, password=password)
        forged = make_phone_proof(PHONE)[:-3] + "abc"

        api_client.post(
            LOGIN_URL,
            {"email": customer.email, "password": password, "phone_proof": forged},
            format="json",
        )

        customer.refresh_from_db()
        assert customer.phone_verified_at is None

    def test_a_wrong_password_links_nothing(self, api_client, password):
        customer = CustomerFactory(phone=PHONE, password=password)

        response = api_client.post(
            LOGIN_URL,
            {"email": customer.email, "password": "nope", "phone_proof": make_phone_proof(PHONE)},
            format="json",
        )

        assert response.status_code == 401
        customer.refresh_from_db()
        assert customer.phone_verified_at is None


class TestStaffNeverSignInBySms:
    def test_even_with_a_valid_code_a_staff_number_is_refused(self, api_client):
        # A code can't reach a staff number, but if one ever did it would still be refused.
        from apps.accounts.phone import _hash

        OperatorUserFactory(phone=PHONE)
        verification = PhoneVerification(
            phone=PHONE, expires_at=timezone.now() + timedelta(minutes=5)
        )
        verification.code_hash = _hash(verification, "246810")
        verification.save()

        response = verify(api_client, "246810")

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "phone_sign_in_unavailable"
        assert COOKIE not in response.cookies


class TestPhoneOnlyAccounts:
    @pytest.fixture
    def phone_customer(self):
        return User.objects.create_phone_customer(PHONE)

    def test_may_add_and_remove_an_email(self, phone_customer):
        client = APIClient()
        client.force_authenticate(phone_customer)

        added = client.patch(ME_URL, {"email": "Kasuni@Example.com"}, format="json")
        assert added.status_code == 200 and added.json()["email"] == "kasuni@example.com"

        removed = client.patch(ME_URL, {"email": ""}, format="json")
        assert removed.status_code == 200 and removed.json()["email"] is None

    def test_cannot_change_the_number_they_sign_in_with(self, phone_customer):
        client = APIClient()
        client.force_authenticate(phone_customer)

        response = client.patch(ME_URL, {"phone": "071 000 0000"}, format="json")

        assert response.status_code == 400
        assert "phone" in response.json()["error"]["details"]

    def test_a_password_account_cannot_remove_its_sign_in_email(self, customer):
        client = APIClient()
        client.force_authenticate(customer)

        response = client.patch(ME_URL, {"email": ""}, format="json")

        assert response.status_code == 400

    def test_a_password_account_changing_its_number_must_prove_it_again(self, customer):
        customer.phone_verified_at = timezone.now()
        customer.save()
        client = APIClient()
        client.force_authenticate(customer)

        assert client.patch(ME_URL, {"phone": "071 000 0000"}, format="json").status_code == 200
        customer.refresh_from_db()
        assert customer.phone_verified_at is None

    def test_many_phone_only_accounts_can_exist_without_emails(self):
        User.objects.create_phone_customer("+94771111111")
        User.objects.create_phone_customer("+94772222222")

        assert User.objects.filter(email__isnull=True).count() == 2
        assert str(User.objects.get(phone="+94771111111")) == "+94771111111"
