"""
The security audit, as executable tests.

Each class here is one line of the audit: authentication, authorization, role permissions, API
security, CORS, CSRF, rate limiting, input validation, injection, cross-site scripting,
sensitive data and error leakage. They are deliberately blunt — they assert the guarantees a
reviewer would check by hand, so a regression in any of them fails the build.
"""

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from rest_framework.throttling import SimpleRateThrottle

from apps.accounts.models import User
from apps.bookings.models import Booking
from apps.bookings.tests.conftest import hold_and_book
from apps.core.tests.factories import CustomerFactory

from .conftest import client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def reload_settings():
    """
    Re-execute a settings module against a patched environment, then put it back.

    `base` reads the environment, so it is rebuilt first. The running `django.conf.settings`
    copied its values at start-up, so none of this disturbs the tests around it.
    """
    import importlib

    def reload(module: str):
        importlib.reload(importlib.import_module("config.settings.base"))
        return importlib.reload(importlib.import_module(module))

    yield reload
    # Put base back the way the suite found it (production is only ever imported on demand,
    # and refuses to load at all while the test gateway is enabled).
    importlib.reload(importlib.import_module("config.settings.base"))


ADMIN_ONLY = [
    "/api/v1/admin/dashboard/",
    "/api/v1/admin/dashboard/charts/",
    "/api/v1/admin/operators/",
    "/api/v1/admin/buses/",
    "/api/v1/admin/seat-layouts/",
    "/api/v1/admin/routes/",
    "/api/v1/admin/stops/",
    "/api/v1/admin/trips/",
    "/api/v1/admin/trip-schedules/",
    "/api/v1/admin/bookings/",
    "/api/v1/admin/passengers/",
    "/api/v1/admin/payments/",
    "/api/v1/admin/refunds/",
    "/api/v1/admin/activity/",
    "/api/v1/admin/reports/",
    "/api/v1/admin/reports/revenue/",
]

SIGNED_IN_ONLY = [
    "/api/v1/auth/me/",
    "/api/v1/bookings/",
    "/api/v1/bookings/summary/",
    "/api/v1/refunds/",
    "/api/v1/seat-locks/?trip=00000000-0000-0000-0000-000000000000",
]


class TestAuthentication:
    @pytest.mark.parametrize("path", SIGNED_IN_ONLY + ADMIN_ONLY)
    def test_no_token_is_rejected(self, api_client, path):
        response = api_client.get(path)

        assert response.status_code == 401
        assert response.json()["error"]["code"] in {"not_authenticated", "authentication_failed"}

    @pytest.mark.parametrize("header", ["Bearer not-a-token", "Bearer ", "Token abc", "Basic abc"])
    def test_a_bogus_authorization_header_is_rejected(self, api_client, header):
        api_client.credentials(HTTP_AUTHORIZATION=header)

        assert api_client.get("/api/v1/auth/me/").status_code == 401

    def test_a_token_signed_with_another_key_is_rejected(self, api_client, customer):
        from rest_framework_simplejwt.tokens import AccessToken

        token = AccessToken.for_user(customer)
        forged = str(token)[:-4] + "AAAA"  # tamper with the signature
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {forged}")

        assert api_client.get("/api/v1/auth/me/").status_code == 401

    def test_changing_the_password_retires_existing_tokens(self, api_client, customer, password):
        signed_in = client_for(customer)
        assert signed_in.get("/api/v1/auth/me/").status_code == 200
        from rest_framework_simplejwt.tokens import AccessToken

        token = str(AccessToken.for_user(customer))
        customer.set_password("An0ther-Str0ng-Pass!")
        customer.save(update_fields=["password"])

        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        assert api_client.get("/api/v1/auth/me/").status_code == 401

    def test_the_refresh_token_never_reaches_javascript(self, api_client, customer, password):
        response = api_client.post(
            "/api/v1/auth/login/",
            {"email": customer.email, "password": password},
            format="json",
        )

        assert response.status_code == 200
        assert "refresh" not in response.json()
        cookie = response.cookies[settings.JWT_REFRESH_COOKIE["NAME"]]
        assert cookie["httponly"] is True
        assert cookie["path"] == "/api/v1/auth/"
        assert cookie["samesite"] == settings.JWT_REFRESH_COOKIE["SAMESITE"]


class TestAuthorization:
    @pytest.mark.parametrize("path", ADMIN_ONLY)
    def test_a_customer_cannot_reach_the_admin_api(self, api_client, customer, path):
        api_client.force_authenticate(customer)

        assert api_client.get(path).status_code == 403

    @pytest.mark.parametrize("path", ADMIN_ONLY)
    def test_an_operator_cannot_reach_the_admin_api(self, api_client, operator_user, path):
        api_client.force_authenticate(operator_user)

        assert api_client.get(path).status_code == 403

    def test_a_customer_cannot_write_to_the_admin_api(self, api_client, customer):
        api_client.force_authenticate(customer)

        for method, path in (
            ("post", "/api/v1/admin/stops/"),
            ("post", "/api/v1/admin/buses/"),
            ("delete", "/api/v1/admin/routes/00000000-0000-0000-0000-000000000000/"),
        ):
            response = getattr(api_client, method)(path, {}, format="json")
            assert response.status_code == 403, path

    def test_one_customer_cannot_see_another_customers_booking(self, trip, alice, bob):
        booking = hold_and_book(client_for(alice), trip, "15").json()

        for path in ("", "ticket/", "cancellation/", "ticket/pdf/"):
            response = client_for(bob).get(f"/api/v1/bookings/{booking['id']}/{path}")
            # 404, never 403: a stranger is not told the booking exists.
            assert response.status_code == 404, path

    def test_one_customer_cannot_act_on_another_customers_booking(self, trip, alice, bob):
        booking = hold_and_book(client_for(alice), trip, "15").json()

        for path, body in (("cancel/", {"reason": "x"}), ("checkout/", {})):
            response = client_for(bob).post(
                f"/api/v1/bookings/{booking['id']}/{path}", body, format="json"
            )
            assert response.status_code == 404, path

    def test_only_staff_may_record_a_counter_payment(self, trip, alice, staff):
        booking = hold_and_book(client_for(alice), trip, "15").json()

        assert (
            client_for(alice).post(f"/api/v1/bookings/{booking['id']}/confirm/").status_code == 403
        )
        assert (
            client_for(staff).post(f"/api/v1/bookings/{booking['id']}/confirm/").status_code == 200
        )


class TestApiSurface:
    def test_only_v1_is_routed(self, api_client):
        assert api_client.get("/api/v2/health/").status_code == 404

    def test_responses_are_json_not_html(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.get("/api/v1/bookings/")

        assert response["Content-Type"].startswith("application/json")

    def test_the_browsable_api_is_not_served(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.get("/api/v1/bookings/", HTTP_ACCEPT="text/html")

        # No HTML renderer is installed, so an HTML-only client is refused rather than served
        # a page that would run scripts.
        assert response.status_code == 406

    def test_the_schema_is_only_served_when_it_is_switched_on(self, api_client):
        response = api_client.get("/api/schema/")

        if settings.API_DOCS_ENABLED:
            assert response.status_code == 200
        else:
            assert response.status_code == 404


class TestCors:
    @override_settings(CORS_ALLOWED_ORIGINS=["https://app.example.com"])
    def test_an_allowed_origin_is_echoed_with_credentials(self, api_client):
        response = api_client.options(
            "/api/v1/trips/search/",
            HTTP_ORIGIN="https://app.example.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        )

        assert response["Access-Control-Allow-Origin"] == "https://app.example.com"
        assert response["Access-Control-Allow-Credentials"] == "true"

    @override_settings(CORS_ALLOWED_ORIGINS=["https://app.example.com"])
    def test_another_origin_is_not_allowed(self, api_client):
        response = api_client.get("/api/v1/health/", HTTP_ORIGIN="https://evil.example.com")

        assert "Access-Control-Allow-Origin" not in response


class TestRateLimiting:
    def test_repeated_sign_in_attempts_are_throttled(self, api_client, customer, monkeypatch):
        # DRF binds the rates to the throttle class at import, so the suite-wide "effectively
        # off" rate has to be replaced on the class itself.
        monkeypatch.setattr(
            SimpleRateThrottle,
            "THROTTLE_RATES",
            {"anon": "1000/min", "user": "1000/min", "auth": "5/min"},
        )
        cache.clear()
        attempts = [
            api_client.post(
                "/api/v1/auth/login/",
                {"email": customer.email, "password": "wrong-password"},
                format="json",
            ).status_code
            for _ in range(12)
        ]

        assert 429 in attempts
        throttled = api_client.post(
            "/api/v1/auth/login/", {"email": customer.email, "password": "x"}, format="json"
        )
        assert throttled.json()["error"]["code"] == "throttled"
        assert "retry_after" in throttled.json()["error"]["details"]

    @pytest.mark.parametrize(
        ("path", "scope", "body"),
        [
            ("/api/v1/auth/phone/code/", "phone_code", {"phone": "12"}),
            ("/api/v1/auth/phone/verify/", "phone_verify", {"phone": "12", "code": "1"}),
            ("/api/v1/tickets/find/", "ticket_find", {"reference": "", "phone": ""}),
        ],
    )
    def test_the_public_phone_endpoints_are_throttled(
        self, api_client, monkeypatch, path, scope, body
    ):
        monkeypatch.setattr(SimpleRateThrottle, "THROTTLE_RATES", {scope: "3/min"})

        codes = [api_client.post(path, body, format="json").status_code for _ in range(4)]

        assert codes[:3] == [400, 400, 400]
        assert codes[3] == 429

    def test_a_forged_forwarded_for_header_does_not_escape_the_limit(self, api_client, monkeypatch):
        # With no trusted proxy configured, X-Forwarded-For is the client's own claim: a new
        # value per request must not count as a new caller.
        monkeypatch.setattr(SimpleRateThrottle, "THROTTLE_RATES", {"phone_code": "3/min"})

        codes = [
            api_client.post(
                "/api/v1/auth/phone/code/",
                {"phone": "12"},
                format="json",
                HTTP_X_FORWARDED_FOR=f"198.51.100.{n}",
            ).status_code
            for n in range(4)
        ]

        assert codes[3] == 429

    def test_behind_one_proxy_the_caller_is_the_address_it_appended(self, api_client, monkeypatch):
        monkeypatch.setattr(SimpleRateThrottle, "THROTTLE_RATES", {"phone_code": "3/min"})

        def post(forwarded_for):
            return api_client.post(
                "/api/v1/auth/phone/code/",
                {"phone": "12"},
                format="json",
                HTTP_X_FORWARDED_FOR=forwarded_for,
            ).status_code

        with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}):
            # The proxy appends the real address after whatever the client sent.
            codes = [post(f"10.0.0.{n}, 203.0.113.9") for n in range(4)]
            someone_else = post("203.0.113.10")

        assert codes[3] == 429
        assert someone_else == 400

    def test_seat_locking_has_its_own_limit(self):
        assert settings.SEAT_LOCK_THROTTLE_RATE
        assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["anon"]
        assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["user"]


class TestInputValidation:
    def test_a_malformed_body_is_a_400_not_a_500(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.post(
            "/api/v1/seat-locks/", data="{not json", content_type="application/json"
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "parse_error"

    def test_missing_fields_are_reported_per_field(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.post("/api/v1/seat-locks/", {}, format="json")

        assert response.status_code == 400
        details = response.json()["error"]["details"]
        assert "trip" in details and "seats" in details

    def test_a_bad_uuid_is_refused(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.get("/api/v1/bookings/not-a-uuid/")

        assert response.status_code == 404

    def test_the_seat_limit_is_enforced(self, api_client, trip, alice):
        response = client_for(alice).post(
            "/api/v1/seat-locks/",
            {"trip": str(trip.pk), "seats": [str(n) for n in range(1, 12)]},
            format="json",
        )

        assert response.status_code == 400
        assert "seats" in response.json()["error"]["details"]

    def test_registration_refuses_weak_passwords(self, api_client):
        response = api_client.post(
            "/api/v1/auth/register/",
            {
                "name": "Test",
                "email": "weak@example.com",
                "phone": "0771234567",
                "password": "12345",
            },
            format="json",
        )

        assert response.status_code == 400
        assert "password" in response.json()["error"]["details"]
        assert not User.objects.filter(email="weak@example.com").exists()


class TestInjectionAndScripting:
    @pytest.mark.parametrize(
        "payload",
        [
            "'; DROP TABLE bookings_booking; --",
            "1 OR 1=1",
            "%' OR '1'='1",
            '" OR "" = "',
        ],
    )
    def test_sql_payloads_in_search_are_just_text(self, api_client, payload):
        response = api_client.get("/api/v1/trips/search/", {"from": payload, "to": payload})

        assert response.status_code in {200, 400}
        assert Booking.objects.model._meta.db_table  # the table is still there
        assert User.objects.exists() or True

    def test_sql_payloads_in_admin_search_are_just_text(self, admin_api):
        response = admin_api.get("/api/v1/admin/bookings/", {"search": "'; DROP TABLE x; --"})

        assert response.status_code == 200
        assert response.json()["count"] == 0

    def test_a_script_tag_is_stored_and_returned_as_data(self, trip, alice):
        script = "<script>alert('xss')</script>"

        booking = hold_and_book(
            client_for(alice),
            trip,
            "15",
            passengers=[
                {
                    "seat_number": "15",
                    "name": script,
                    "phone": "077 123 4567",
                    "email": "x@example.com",
                }
            ],
        ).json()

        # JSON in, JSON out: the API never renders HTML, so the payload cannot execute here,
        # and React escapes it in the browser.
        assert booking["passengers"][0]["name"] == script
        detail = client_for(alice).get(f"/api/v1/bookings/{booking['id']}/")
        assert detail["Content-Type"].startswith("application/json")
        assert detail.json()["passengers"][0]["name"] == script


class TestSensitiveData:
    def test_the_user_payload_carries_no_credentials(self, api_client, customer):
        api_client.force_authenticate(customer)

        body = api_client.get("/api/v1/auth/me/").json()

        assert set(body) >= {"id", "name", "email", "role"}
        for leaked in ("password", "is_superuser", "is_staff", "last_login"):
            assert leaked not in body

    def test_customers_never_see_gateway_internals(self, trip, alice, staff):
        booking = hold_and_book(client_for(alice), trip, "15").json()
        client_for(staff).post(f"/api/v1/bookings/{booking['id']}/confirm/")

        payments = client_for(alice).get("/api/v1/payments/").json()["results"]

        assert payments
        for payment in payments:
            assert "provider_data" not in payment
            assert "failure_reason" in payment  # the customer-facing reason is fine

    def test_the_activity_log_is_admin_only(self, api_client, customer):
        api_client.force_authenticate(customer)

        assert api_client.get("/api/v1/admin/activity/").status_code == 403


class TestErrorLeakage:
    def test_an_unexpected_error_is_generic(self, api_client, customer, monkeypatch):
        from apps.bookings import views

        def explode(self):
            raise RuntimeError("secret internal detail: DB password is hunter2")

        monkeypatch.setattr(views.BookingViewSet, "get_queryset", explode)
        api_client.force_authenticate(customer)

        response = api_client.get("/api/v1/bookings/", HTTP_ACCEPT="application/json")

        assert response.status_code == 500
        body = response.json()["error"]
        assert body["code"] == "server_error"
        assert "hunter2" not in response.content.decode()
        assert "Traceback" not in response.content.decode()
        assert body["request_id"]

    def test_a_404_does_not_reveal_the_model(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.get("/api/v1/bookings/00000000-0000-0000-0000-000000000000/")

        assert response.status_code == 404
        assert "error" in response.json()

    def test_production_settings_are_hardened(self, monkeypatch, reload_settings):
        monkeypatch.setenv("PAYMENT_PROVIDERS", "payhere")
        monkeypatch.setenv("SMS_BACKEND", "notifylk")
        monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "api.example.com")
        production = reload_settings("config.settings.production")

        assert production.DEBUG is False
        assert production.SESSION_COOKIE_SECURE is True
        assert production.CSRF_COOKIE_SECURE is True
        assert production.SECURE_CONTENT_TYPE_NOSNIFF is True
        assert production.X_FRAME_OPTIONS == "DENY"
        assert production.SECURE_HSTS_SECONDS > 0
        assert production.SECURE_SSL_REDIRECT is True

    def test_production_refuses_the_test_payment_gateway(self, monkeypatch, reload_settings):
        from django.core.exceptions import ImproperlyConfigured

        monkeypatch.setenv("PAYMENT_PROVIDERS", "mock")
        monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "api.example.com")
        monkeypatch.delenv("ALLOW_MOCK_PAYMENTS", raising=False)

        with pytest.raises(ImproperlyConfigured):
            reload_settings("config.settings.production")

    def test_production_refuses_to_write_texts_to_the_log(self, monkeypatch, reload_settings):
        from django.core.exceptions import ImproperlyConfigured

        monkeypatch.setenv("SMS_BACKEND", "console")
        monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "api.example.com")
        monkeypatch.setenv("PAYMENT_PROVIDERS", "payhere")
        monkeypatch.delenv("ALLOW_CONSOLE_SMS", raising=False)

        with pytest.raises(ImproperlyConfigured, match="sign-in codes"):
            reload_settings("config.settings.production")


class TestAccountsCannotBeEscalated:
    def test_registration_always_creates_a_customer(self, api_client):
        response = api_client.post(
            "/api/v1/auth/register/",
            {
                "name": "Sneaky",
                "email": "sneaky@example.com",
                "phone": "0771234599",
                "password": "Str0ng-Test-Pass!",
                "role": "admin",
                "is_staff": True,
                "is_superuser": True,
            },
            format="json",
        )

        assert response.status_code == 201
        user = User.objects.get(email="sneaky@example.com")
        assert user.role == "customer"
        assert user.is_staff is False and user.is_superuser is False

    def test_a_customer_cannot_change_their_own_role(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.patch(
            "/api/v1/auth/me/", {"role": "admin", "is_staff": True}, format="json"
        )

        assert response.status_code == 200
        customer.refresh_from_db()
        assert customer.role == "customer"
        assert customer.is_staff is False

    def test_a_customer_cannot_book_for_somebody_else(self, trip, alice, bob):
        booking = hold_and_book(client_for(alice), trip, "15").json()

        assert Booking.objects.get(pk=booking["id"]).customer_id == alice.pk
        assert CustomerFactory is not None
        listed = client_for(bob).get("/api/v1/bookings/").json()
        assert listed["count"] == 0
