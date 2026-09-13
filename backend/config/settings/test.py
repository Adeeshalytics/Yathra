"""Settings for the automated test suite."""

from .base import *  # noqa: F403
from .base import JWT_REFRESH_COOKIE, REST_FRAMEWORK

DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]

# Hashing speed matters more than strength in tests.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

JWT_REFRESH_COOKIE = {**JWT_REFRESH_COOKIE, "SECURE": False}

REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {
        "anon": "1000/min",
        "user": "1000/min",
        "auth": "1000/min",
        "phone_code": "1000/min",
        "phone_verify": "1000/min",
        "ticket_link": "1000/min",
        "ticket_find": "1000/min",
    },
}
SEAT_LOCK_THROTTLE_RATE = "10000/min"
PAYMENT_VERIFY_THROTTLE_RATE = "10000/min"

# Never reach out to a routing service from a test; the ones that exercise it patch it.
ROUTING_SERVICE = {"URL": "", "PROFILE": "driving", "TIMEOUT_SECONDS": 1.0}

# Tests pay through the built-in test gateway; PayHere tests pass their own settings.
PAYMENT_PROVIDERS = ["mock", "payhere"]
PAYMENT_DEFAULT_PROVIDER = "mock"
MOCK_PAYMENT_SECRET = "test-mock-secret"  # noqa: S105
PAYHERE = {
    "MERCHANT_ID": "1211149",
    "MERCHANT_SECRET": "test-merchant-secret",
    "APP_ID": "",
    "APP_SECRET": "",
    "SANDBOX": True,
}
FRONTEND_URL = "http://localhost:3000"

# Text messages land in apps.notifications.sms.outbox and e-mails in django.core.mail.outbox.
SMS = {"BACKEND": "locmem", "SENDER_ID": "Yathra", "TIMEOUT_SECONDS": 1.0}
NOTIFICATIONS = {"DELIVERY": "inline", "REMINDER_HOURS_BEFORE": 3, "MAX_ATTEMPTS": 5}
PHONE_SIGN_IN = {
    "CODE_TTL_MINUTES": 5,
    "MAX_ATTEMPTS": 5,
    "RESEND_SECONDS": 60,
    "MAX_CODES_PER_HOUR": 5,
}
PUBLIC_API_URL = "http://testserver"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"null": {"class": "logging.NullHandler"}},
    "root": {"handlers": ["null"]},
}
